package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.MinioOperationException;
import com.example.smartrec.model.dto.MeetingPlaybackResponse;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.MeetingServiceImpl;

@ExtendWith(MockitoExtension.class)
class MeetingPlaybackTest {
    @Mock private MeetingRepository meetingRepository;
    @Mock private MediaFileRepository mediaFileRepository;
    @Mock private UserRepository userRepository;
    @Mock private MinioService minioService;
    @InjectMocks private MeetingServiceImpl meetingService;

    private final UUID userId = UUID.randomUUID();
    private final UUID meetingId = UUID.randomUUID();
    private final UUID mediaId = UUID.randomUUID();
    private final UUID ownerId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken("alice@example.com", null, List.of(() -> "USER")));
        ReflectionTestUtils.setField(meetingService, "playbackUrlExpirySeconds", 900);
        lenient().when(userRepository.findByEmail("alice@example.com"))
                .thenReturn(Optional.of(User.builder().id(userId).email("alice@example.com").build()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void createsShortLivedUrlForOwnedMeetingWithUploadedMedia() throws Exception {
        givenOwnedMeeting(MediaFileStatus.UPLOADED);
        when(minioService.presignGetObject("recordings/source.mp4", 900))
                .thenReturn("https://minio.example/signed?signature=secret");

        MeetingPlaybackResponse response = meetingService.getPlaybackUrl(meetingId);

        assertEquals("https://minio.example/signed?signature=secret", response.url());
        assertEquals(900, response.expiresIn());
        verify(minioService).presignGetObject("recordings/source.mp4", 900);
    }

    @Test
    void rejectsMeetingOwnedByAnotherUserBeforeSigning() throws Exception {
        Meeting meeting = Meeting.builder()
                .id(meetingId).workspace_id(ownerId).media_file_id(mediaId).build();
        when(meetingRepository.findById(meetingId)).thenReturn(Optional.of(meeting));

        BusinessException error = assertThrows(BusinessException.class,
                () -> meetingService.getPlaybackUrl(meetingId));

        assertEquals(HttpStatus.FORBIDDEN, error.getStatus());
        verify(minioService, never()).presignGetObject(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void rejectsMissingMeeting() throws Exception {
        when(meetingRepository.findById(meetingId)).thenReturn(Optional.empty());

        BusinessException error = assertThrows(BusinessException.class,
                () -> meetingService.getPlaybackUrl(meetingId));

        assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
        verify(minioService, never()).presignGetObject(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void rejectsUnauthenticatedRequestBeforeLookingUpMeeting() throws Exception {
        SecurityContextHolder.clearContext();

        BusinessException error = assertThrows(BusinessException.class,
                () -> meetingService.getPlaybackUrl(meetingId));

        assertEquals(HttpStatus.UNAUTHORIZED, error.getStatus());
        verify(meetingRepository, never()).findById(meetingId);
        verify(minioService, never()).presignGetObject(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void doesNotSignTrashedPurgedOrIntegrityFailedMedia() throws Exception {
        for (String status : List.of(MediaFileStatus.TRASHED, MediaFileStatus.PURGED, MediaFileStatus.INTEGRITY_FAILED)) {
            givenOwnedMeeting(status);

            BusinessException error = assertThrows(BusinessException.class,
                    () -> meetingService.getPlaybackUrl(meetingId));

            assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
        }
        verify(minioService, never()).presignGetObject(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void wrapsMinioSigningFailureWithoutExposingDetails() throws Exception {
        givenOwnedMeeting(MediaFileStatus.UPLOADED);
        when(minioService.presignGetObject("recordings/source.mp4", 900))
                .thenThrow(new IllegalStateException("MinIO signing failure"));

        MinioOperationException error = assertThrows(MinioOperationException.class,
                () -> meetingService.getPlaybackUrl(meetingId));

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, error.getStatus());
        assertTrue(!error.getMessage().contains("recordings/source.mp4"));
    }

    private void givenOwnedMeeting(String mediaStatus) {
        Meeting meeting = Meeting.builder()
                .id(meetingId).workspace_id(userId).media_file_id(mediaId).build();
        MediaFile mediaFile = MediaFile.builder()
                .id(mediaId).status(mediaStatus).object_key("recordings/source.mp4").build();
        when(meetingRepository.findById(meetingId)).thenReturn(Optional.of(meeting));
        when(mediaFileRepository.findById(mediaId)).thenReturn(Optional.of(mediaFile));
    }
}
