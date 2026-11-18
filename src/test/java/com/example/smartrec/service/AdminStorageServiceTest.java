package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.PendingMediaUpload;
import com.example.smartrec.entity.UploadSession;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.StorageCleanupTaskType;
import com.example.smartrec.enums.UploadSessionStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.MinioObjectSummary;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.AdminStorageObjectResponse;
import com.example.smartrec.model.dto.StorageCleanupResponse;
import com.example.smartrec.model.dto.StorageOverviewResponse;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.PendingMediaUploadRepository;
import com.example.smartrec.repository.UploadSessionRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.AdminStorageServiceImpl;

@ExtendWith(MockitoExtension.class)
class AdminStorageServiceTest {
    @Mock private MediaFileRepository mediaFileRepository;
    @Mock private PendingMediaUploadRepository pendingUploadRepository;
    @Mock private UploadSessionRepository uploadSessionRepository;
    @Mock private MeetingRepository meetingRepository;
    @Mock private UserRepository userRepository;
    @Mock private MinioService minioService;
    @Mock private TrashService trashService;
    @Mock private ChunkMergeAsyncService chunkMergeAsyncService;
    @Mock private UploadSessionRedisService uploadSessionRedisService;

    private AdminStorageServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new AdminStorageServiceImpl(
                mediaFileRepository,
                pendingUploadRepository,
                uploadSessionRepository,
                meetingRepository,
                userRepository,
                minioService,
                trashService,
                chunkMergeAsyncService,
                uploadSessionRedisService);
    }

    @Test
    void getOverview_computesMetricsAndDetectsMinioOrphans_ignoringActiveUploadChunks() throws Exception {
        Instant now = Instant.now();
        UUID activeSessionId = UUID.randomUUID();
        UUID cancelledSessionId = UUID.randomUUID();

        MediaFile uploadedAudio = MediaFile.builder()
                .id(UUID.randomUUID())
                .workspace_id(UUID.randomUUID())
                .uploaded_by(UUID.randomUUID())
                .original_name("weekly-sync.mp3")
                .object_key("media/weekly-sync.mp3")
                .mime_type("audio/mpeg")
                .file_size_bytes(2_000_000L)
                .status(MediaFileStatus.UPLOADED)
                .created_at(now)
                .build();

        MediaFile expiredTrash = MediaFile.builder()
                .id(UUID.randomUUID())
                .workspace_id(UUID.randomUUID())
                .uploaded_by(UUID.randomUUID())
                .original_name("old-recording.mp4")
                .object_key("media/old-recording.mp4")
                .mime_type("video/mp4")
                .file_size_bytes(5_000_000L)
                .status(MediaFileStatus.TRASHED)
                .purge_at(now.minus(1, ChronoUnit.HOURS))
                .created_at(now)
                .build();

        PendingMediaUpload stalePending = PendingMediaUpload.builder()
                .id(UUID.randomUUID())
                .userId(UUID.randomUUID())
                .objectKey("pending/stale.wav")
                .fileName("stale.wav")
                .fileSizeBytes(1_200_000L)
                .mimeType("audio/wav")
                .status("PENDING")
                .expiresAt(now.minus(2, ChronoUnit.HOURS))
                .build();

        UploadSession activeSession = UploadSession.builder()
                .id(activeSessionId)
                .userId(UUID.randomUUID())
                .totalChunks(10)
                .status(UploadSessionStatus.UPLOADING)
                .build();

        UploadSession cancelledSession = UploadSession.builder()
                .id(cancelledSessionId)
                .userId(UUID.randomUUID())
                .totalChunks(4)
                .status(UploadSessionStatus.CANCELLED)
                .build();

        when(mediaFileRepository.findAll()).thenReturn(List.of(uploadedAudio, expiredTrash));
        when(pendingUploadRepository.findAll()).thenReturn(List.of(stalePending));
        when(uploadSessionRepository.findAll()).thenReturn(List.of(activeSession, cancelledSession));
        when(minioService.getBucketName()).thenReturn("smartrec-media");
        when(minioService.isBucketHealthy()).thenReturn(true);
        when(minioService.listObjectsSummary(anyInt())).thenReturn(List.of(
                new MinioObjectSummary("media/weekly-sync.mp3", 2_000_000L, now, "e1"),
                new MinioObjectSummary("pending/stale.wav", 1_200_000L, now, "e2"),
                new MinioObjectSummary("tmp/" + activeSessionId + "/chunk_0", 512_000L, now, "e3"),
                new MinioObjectSummary("orphan/dangling-ghost.mkv", 3_500_000L, now, "e4")
        ));

        StorageOverviewResponse overview = service.getOverview();

        assertEquals("smartrec-media", overview.bucketName());
        assertTrue(overview.minioConnected());
        assertTrue(overview.bucketHealthy());
        assertEquals(2L, overview.totalFiles());
        assertEquals(7_000_000L, overview.totalSizeBytes());
        assertEquals(1L, overview.uploadedFiles());
        assertEquals(1L, overview.trashedFiles());
        assertEquals(1L, overview.expiredTrashCount());
        assertEquals(1L, overview.pendingUploadsCount());
        assertEquals(1L, overview.stalePendingUploadsCount());
        assertEquals(1L, overview.activeUploadSessionsCount());
        assertEquals(1L, overview.cancelledUploadSessionsCount());
        assertEquals(4L, overview.minioObjectCount());
        assertEquals(1L, overview.orphanObjectCount());
        assertEquals(3_500_000L, overview.orphanTotalSizeBytes());
    }

    @Test
    void getOverview_degradesGracefullyWhenMinioUnavailable() {
        when(mediaFileRepository.findAll()).thenReturn(List.of());
        when(pendingUploadRepository.findAll()).thenReturn(List.of());
        when(uploadSessionRepository.findAll()).thenReturn(List.of());
        when(minioService.getBucketName()).thenReturn("smartrec-media");
        when(minioService.isBucketHealthy()).thenReturn(false);

        StorageOverviewResponse overview = service.getOverview();

        assertFalse(overview.minioConnected());
        assertFalse(overview.bucketHealthy());
        assertNotNull(overview.minioWarning());
        assertEquals(0L, overview.orphanObjectCount());
    }

    @Test
    void listObjects_returnsPagedObjectsWithBatchUploaderLookupAndLinkedMeetingFlag() {
        UUID userId = UUID.randomUUID();
        UUID mediaId = UUID.randomUUID();
        MediaFile mf = MediaFile.builder()
                .id(mediaId)
                .workspace_id(UUID.randomUUID())
                .uploaded_by(userId)
                .original_name("board-meeting.mp4")
                .object_key("media/board-meeting.mp4")
                .mime_type("video/mp4")
                .file_size_bytes(10_485_760L)
                .status(MediaFileStatus.UPLOADED)
                .created_at(Instant.now())
                .build();

        when(mediaFileRepository.adminSearchStorageObjects(eq("UPLOADED"), eq("board"), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(mf)));
        when(userRepository.findAllById(any())).thenReturn(List.of(
                User.builder().id(userId).full_name("Minh Nguyen").email("minh@smartrec.vn").build()));
        when(meetingRepository.findLinkedMediaFileIds(any())).thenReturn(List.of(mediaId));

        PageResponse<AdminStorageObjectResponse> page = service.listObjects(
                "UPLOADED", "board", "file_size_bytes,desc", 0, 10);

        assertEquals(1, page.getContent().size());
        AdminStorageObjectResponse item = page.getContent().get(0);
        assertEquals("Minh Nguyen", item.uploaderName());
        assertEquals("minh@smartrec.vn", item.uploaderEmail());
        assertTrue(item.hasLinkedMeeting());
    }

    @Test
    void deleteStorageObject_blocksLinkedMeetingWithoutForceAndDeletesWhenForced() {
        UUID mediaId = UUID.randomUUID();
        MediaFile mf = MediaFile.builder()
                .id(mediaId)
                .object_key("media/linked.mp3")
                .status(MediaFileStatus.UPLOADED)
                .file_size_bytes(1024L)
                .build();

        when(mediaFileRepository.findById(mediaId)).thenReturn(Optional.of(mf));
        when(meetingRepository.findByMediaFileId(mediaId)).thenReturn(Optional.of(new Meeting()));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.deleteStorageObject(mediaId, false));
        assertEquals(HttpStatus.CONFLICT, ex.getStatus());
        assertEquals("MEDIA_LINKED_TO_MEETING", ex.getCode());
        verify(trashService, never()).deleteMinioThenDatabase(any());

        service.deleteStorageObject(mediaId, true);
        verify(trashService).deleteMinioThenDatabase(mf);
    }

    @Test
    void runCleanup_allSafe_cleansAllGarbageBucketsSafely() throws Exception {
        Instant now = Instant.now();
        MediaFile expiredTrash = MediaFile.builder()
                .id(UUID.randomUUID())
                .object_key("trash/expired.mp3")
                .file_size_bytes(1000L)
                .status(MediaFileStatus.TRASHED)
                .build();
        PendingMediaUpload stalePending = PendingMediaUpload.builder()
                .id(UUID.randomUUID())
                .objectKey("pending/old.mp3")
                .fileSizeBytes(2000L)
                .status("PENDING")
                .build();
        UploadSession cancelledSession = UploadSession.builder()
                .id(UUID.randomUUID())
                .totalChunks(3)
                .status(UploadSessionStatus.CANCELLED)
                .build();

        when(mediaFileRepository.findExpiredTrash(eq(MediaFileStatus.TRASHED), any(Instant.class)))
                .thenReturn(List.of(expiredTrash));
        when(pendingUploadRepository.findTop100ByStatusAndExpiresAtBeforeOrderByExpiresAtAsc(
                eq("PENDING"), any(Instant.class)))
                .thenReturn(List.of(stalePending));
        when(minioService.objectExists("pending/old.mp3")).thenReturn(true);
        when(uploadSessionRepository.findTop100ByStatusAndUpdatedAtBeforeOrderByUpdatedAtAsc(
                eq(UploadSessionStatus.CANCELLED), any(Instant.class)))
                .thenReturn(List.of(cancelledSession));
        when(chunkMergeAsyncService.cleanupCancelledSession(cancelledSession.getId(), 3)).thenReturn(true);

        when(mediaFileRepository.findAll()).thenReturn(List.of());
        when(pendingUploadRepository.findAll()).thenReturn(List.of());
        when(uploadSessionRepository.findAll()).thenReturn(List.of());
        when(minioService.isBucketHealthy()).thenReturn(true);
        when(minioService.listObjectsSummary(anyInt())).thenReturn(List.of(
                new MinioObjectSummary("orphan/stale.tmp", 3000L, now, "e1")));

        StorageCleanupResponse response = service.runCleanup(StorageCleanupTaskType.ALL_SAFE);

        assertEquals(StorageCleanupTaskType.ALL_SAFE, response.taskType());
        assertEquals(4, response.processedCount());
        assertEquals(4, response.deletedCount());
        assertEquals(0, response.failedCount());
        assertEquals(6000L, response.freedBytes());
        verify(trashService).deleteMinioThenDatabase(expiredTrash);
        verify(minioService).delete("pending/old.mp3");
        verify(uploadSessionRedisService).delete(cancelledSession.getId());
        verify(uploadSessionRepository).delete(cancelledSession);
        verify(minioService).delete("orphan/stale.tmp");
    }
}

