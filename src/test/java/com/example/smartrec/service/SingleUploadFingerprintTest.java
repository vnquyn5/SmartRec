package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.task.TaskExecutor;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.User;
import com.example.smartrec.model.dto.SimpleUploadCompleteRequest;
import com.example.smartrec.model.dto.UploadDuplicateCheckRequest;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.FileServiceImpl;

@ExtendWith(MockitoExtension.class)
class SingleUploadFingerprintTest {
    private static final String FINGERPRINT = "a".repeat(64);
    private static final String CHECKSUM = "b".repeat(64);
    @Mock MediaFileRepository mediaFileRepository;
    @Mock MeetingRepository meetingRepository;
    @Mock UserRepository userRepository;
    @Mock MinioService minioService;
    @Mock FileChecksumService fileChecksumService;
    @Mock TaskExecutor applicationTaskExecutor;
    @InjectMocks FileServiceImpl service;
    private User user;
    private SimpleUploadCompleteRequest request;

    @BeforeEach
    void setUp() {
        user = User.builder().id(UUID.randomUUID()).email("alice@example.com").full_name("Alice").build();
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken(user.getEmail(), null, "ROLE_USER"));
        when(userRepository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        LocalDate today = LocalDate.now();
        request = new SimpleUploadCompleteRequest();
        request.setObjectKey("Alice/" + String.format("%02d", today.getMonthValue()) + "-" + today.getYear()
                + "/recording.mp4");
        request.setFileName("recording.mp4");
        request.setFileSize(100L);
        request.setQuickFingerprint(FINGERPRINT);
        request.setFingerprintVersion(2);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void savesFingerprintOnNewCompletionWithClientChecksum() throws Exception {
        request.setChecksumSha256(CHECKSUM);
        TransactionSynchronizationManager.initSynchronization();
        when(minioService.getObjectSize(request.getObjectKey())).thenReturn(100L);
        when(mediaFileRepository.saveAndFlush(any(MediaFile.class))).thenAnswer(invocation -> {
            MediaFile saved = invocation.getArgument(0);
            saved.setId(UUID.randomUUID());
            assertEquals(FINGERPRINT, saved.getQuickFingerprint());
            assertEquals(2, saved.getFingerprintVersion());
            assertEquals(CHECKSUM, saved.getChecksumSha256());
            return saved;
        });
        when(meetingRepository.saveAndFlush(any(Meeting.class))).thenReturn(meeting(UUID.randomUUID()));

        service.completeSimpleUpload(request);

        verify(mediaFileRepository).saveAndFlush(any(MediaFile.class));
        verifyNoInteractions(fileChecksumService);
    }

    @Test
    void fillsMissingMetadataOnIdempotentCompletionAndEnablesQuickDuplicateLookup() {
        MediaFile existing = existing(null, null);
        stubExisting(existing);
        service.completeSimpleUpload(request);
        assertEquals(FINGERPRINT, existing.getQuickFingerprint());
        assertEquals(2, existing.getFingerprintVersion());
        verify(mediaFileRepository).save(existing);
        verifyNoInteractions(minioService, fileChecksumService, applicationTaskExecutor);

        when(mediaFileRepository.findActiveByUserAndQuickFingerprintVersion(user.getId(), FINGERPRINT, 2))
                .thenReturn(List.of(existing));
        UploadDuplicateCheckRequest duplicate = new UploadDuplicateCheckRequest();
        duplicate.setFileName(request.getFileName());
        duplicate.setFileSize(request.getFileSize());
        duplicate.setQuickFingerprint(FINGERPRINT);
        duplicate.setFingerprintVersion(2);
        assertTrue(service.checkDuplicate(duplicate).isExists());
    }

    @Test
    void doesNotEraseExistingMetadataWhenOldClientOmitsIt() {
        MediaFile existing = existing(FINGERPRINT, 2);
        stubExisting(existing);
        request.setQuickFingerprint(null);
        request.setFingerprintVersion(null);
        service.completeSimpleUpload(request);
        assertEquals(FINGERPRINT, existing.getQuickFingerprint());
        assertEquals(2, existing.getFingerprintVersion());
        verify(mediaFileRepository, never()).save(any());
    }

    @Test
    void preservesExistingFingerprintWhenRetrySuppliesAnotherValue() {
        MediaFile existing = existing("c".repeat(64), 1);
        stubExisting(existing);
        service.completeSimpleUpload(request);
        assertEquals("c".repeat(64), existing.getQuickFingerprint());
        assertEquals(1, existing.getFingerprintVersion());
        verify(mediaFileRepository, never()).save(any());
    }

    @Test
    void fillsMissingVersionForMatchingFingerprint() {
        MediaFile existing = existing(FINGERPRINT, null);
        stubExisting(existing);
        service.completeSimpleUpload(request);
        assertEquals(2, existing.getFingerprintVersion());
        verify(mediaFileRepository).save(existing);
    }

    private MediaFile existing(String fingerprint, Integer version) {
        return MediaFile.builder().id(UUID.randomUUID()).uploaded_by(user.getId()).workspace_id(user.getId())
                .original_name(request.getFileName()).object_key(request.getObjectKey()).file_size_bytes(100L)
                .quickFingerprint(fingerprint).fingerprintVersion(version).checksumSha256(CHECKSUM)
                .status(MediaFileStatus.UPLOADED).build();
    }

    private void stubExisting(MediaFile existing) {
        when(mediaFileRepository.findAllByObjectKey(request.getObjectKey())).thenReturn(List.of(existing));
        when(meetingRepository.findByMediaFileId(existing.getId())).thenReturn(Optional.of(meeting(existing.getId())));
    }

    private Meeting meeting(UUID mediaFileId) {
        return Meeting.builder().id(UUID.randomUUID()).media_file_id(mediaFileId).status(MeetingStatus.PENDING).build();
    }
}
