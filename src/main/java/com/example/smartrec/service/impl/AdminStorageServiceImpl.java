package com.example.smartrec.service.impl;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.entity.PendingMediaUpload;
import com.example.smartrec.entity.UploadSession;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.StorageCleanupTaskType;
import com.example.smartrec.enums.UploadSessionStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.MinioOperationException;
import com.example.smartrec.exception.ResourceNotFoundException;
import com.example.smartrec.model.dto.AdminStorageObjectResponse;
import com.example.smartrec.model.dto.MinioObjectSummary;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.StorageCleanupResponse;
import com.example.smartrec.model.dto.StorageOverviewResponse;
import com.example.smartrec.model.dto.StorageOverviewResponse.DailyTrendBucket;
import com.example.smartrec.model.dto.StorageOverviewResponse.MimeBucket;
import com.example.smartrec.model.dto.StorageOverviewResponse.StatusBucket;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.PendingMediaUploadRepository;
import com.example.smartrec.repository.UploadSessionRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.AdminStorageService;
import com.example.smartrec.service.ChunkMergeAsyncService;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.TrashService;
import com.example.smartrec.service.UploadSessionRedisService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class AdminStorageServiceImpl implements AdminStorageService {
    private static final Logger log = LoggerFactory.getLogger(AdminStorageServiceImpl.class);
    private static final int MAX_MINIO_SCAN_OBJECTS = 5000;
    private static final int TREND_DAYS = 14;
    private static final Set<String> ALLOWED_SORT_FIELDS = Set.of(
            "created_at", "file_size_bytes", "original_name", "deleted_at", "purge_at");
    private static final Set<UploadSessionStatus> TERMINAL_SESSION_STATUSES = EnumSet.of(
            UploadSessionStatus.COMPLETED,
            UploadSessionStatus.CANCELLED,
            UploadSessionStatus.FAILED);

    private final MediaFileRepository mediaFileRepository;
    private final PendingMediaUploadRepository pendingUploadRepository;
    private final UploadSessionRepository uploadSessionRepository;
    private final MeetingRepository meetingRepository;
    private final UserRepository userRepository;
    private final MinioService minioService;
    private final TrashService trashService;
    private final ChunkMergeAsyncService chunkMergeAsyncService;
    private final UploadSessionRedisService uploadSessionRedisService;

    @Override
    @Transactional(readOnly = true)
    public StorageOverviewResponse getOverview() {
        Instant now = Instant.now();
        List<MediaFile> mediaFiles = mediaFileRepository.findAll();
        List<PendingMediaUpload> pendingUploads = pendingUploadRepository.findAll();
        List<UploadSession> uploadSessions = uploadSessionRepository.findAll();

        long totalFiles = mediaFiles.size();
        long totalSizeBytes = 0L;
        long uploadedFiles = 0L;
        long uploadedSizeBytes = 0L;
        long trashedFiles = 0L;
        long trashedSizeBytes = 0L;
        long uploadingFiles = 0L;
        long uploadingSizeBytes = 0L;
        long integrityFailedFiles = 0L;
        long integrityFailedSizeBytes = 0L;
        long expiredTrashCount = 0L;
        long expiredTrashBytes = 0L;

        Map<String, long[]> statusTotals = new LinkedHashMap<>();
        statusTotals.put(MediaFileStatus.UPLOADED, new long[] {0L, 0L});
        statusTotals.put(MediaFileStatus.TRASHED, new long[] {0L, 0L});
        statusTotals.put(MediaFileStatus.UPLOADING, new long[] {0L, 0L});
        statusTotals.put(MediaFileStatus.INTEGRITY_FAILED, new long[] {0L, 0L});

        Map<String, long[]> mimeTotals = new LinkedHashMap<>();
        mimeTotals.put("Audio", new long[] {0L, 0L});
        mimeTotals.put("Video", new long[] {0L, 0L});
        mimeTotals.put("Other", new long[] {0L, 0L});

        Map<LocalDate, long[]> dailyBuckets = initializeDailyTrend(now);

        for (MediaFile mf : mediaFiles) {
            long size = safeSize(mf.getFile_size_bytes());
            String status = mf.getStatus() != null ? mf.getStatus() : MediaFileStatus.UPLOADED;
            totalSizeBytes += size;

            statusTotals.computeIfAbsent(status, ignored -> new long[] {0L, 0L});
            statusTotals.get(status)[0]++;
            statusTotals.get(status)[1] += size;

            switch (status) {
                case MediaFileStatus.UPLOADED -> {
                    uploadedFiles++;
                    uploadedSizeBytes += size;
                }
                case MediaFileStatus.TRASHED -> {
                    trashedFiles++;
                    trashedSizeBytes += size;
                    if (mf.getPurge_at() != null && !mf.getPurge_at().isAfter(now)) {
                        expiredTrashCount++;
                        expiredTrashBytes += size;
                    }
                }
                case MediaFileStatus.UPLOADING -> {
                    uploadingFiles++;
                    uploadingSizeBytes += size;
                }
                case MediaFileStatus.INTEGRITY_FAILED -> {
                    integrityFailedFiles++;
                    integrityFailedSizeBytes += size;
                }
                default -> {
                    // Other status counted in statusTotals only
                }
            }

            String mimeCategory = categorizeMime(mf.getMime_type());
            mimeTotals.get(mimeCategory)[0]++;
            mimeTotals.get(mimeCategory)[1] += size;

            if (mf.getCreated_at() != null) {
                LocalDate createdDate = mf.getCreated_at().atZone(ZoneOffset.UTC).toLocalDate();
                long[] dayTotals = dailyBuckets.get(createdDate);
                if (dayTotals != null) {
                    dayTotals[0]++;
                    dayTotals[1] += size;
                }
            }
        }

        long pendingUploadsCount = 0L;
        long stalePendingUploadsCount = 0L;
        long stalePendingUploadBytes = 0L;
        for (PendingMediaUpload pending : pendingUploads) {
            if ("PENDING".equals(pending.getStatus())) {
                pendingUploadsCount++;
                if (pending.getExpiresAt() != null && pending.getExpiresAt().isBefore(now)) {
                    stalePendingUploadsCount++;
                    stalePendingUploadBytes += safeSize(pending.getFileSizeBytes());
                }
            }
        }

        long activeUploadSessionsCount = 0L;
        long cancelledUploadSessionsCount = 0L;
        for (UploadSession session : uploadSessions) {
            UploadSessionStatus sessionStatus = session.getStatus();
            if (sessionStatus == UploadSessionStatus.CANCELLED) {
                cancelledUploadSessionsCount++;
            } else if (sessionStatus != null && !TERMINAL_SESSION_STATUSES.contains(sessionStatus)) {
                activeUploadSessionsCount++;
            }
        }

        MinioScanResult minioScan = scanMinioSafely(mediaFiles, pendingUploads, uploadSessions);

        List<StatusBucket> statusBreakdown = statusTotals.entrySet().stream()
                .map(entry -> new StatusBucket(entry.getKey(), entry.getValue()[0], entry.getValue()[1]))
                .toList();
        List<MimeBucket> mimeBreakdown = mimeTotals.entrySet().stream()
                .map(entry -> new MimeBucket(entry.getKey(), entry.getValue()[0], entry.getValue()[1]))
                .toList();
        List<DailyTrendBucket> recentDailyTrend = dailyBuckets.entrySet().stream()
                .map(entry -> new DailyTrendBucket(
                        entry.getKey().format(DateTimeFormatter.ISO_LOCAL_DATE),
                        entry.getValue()[0],
                        entry.getValue()[1]))
                .toList();

        return new StorageOverviewResponse(
                minioService.getBucketName(),
                minioScan.connected,
                minioScan.bucketHealthy,
                minioScan.warning,
                totalFiles,
                totalSizeBytes,
                uploadedFiles,
                uploadedSizeBytes,
                trashedFiles,
                trashedSizeBytes,
                uploadingFiles,
                uploadingSizeBytes,
                integrityFailedFiles,
                integrityFailedSizeBytes,
                expiredTrashCount,
                expiredTrashBytes,
                pendingUploadsCount,
                stalePendingUploadsCount,
                stalePendingUploadBytes,
                activeUploadSessionsCount,
                cancelledUploadSessionsCount,
                minioScan.minioObjectCount,
                minioScan.minioTotalSizeBytes,
                minioScan.orphans.size(),
                minioScan.orphanTotalSizeBytes,
                statusBreakdown,
                mimeBreakdown,
                recentDailyTrend);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponse<AdminStorageObjectResponse> listObjects(
            String status,
            String keyword,
            String sort,
            int page,
            int size) {
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), 100);
        String normalizedStatus = normalizeFilterStatus(status);
        String normalizedKeyword = keyword == null || keyword.isBlank() ? null : keyword.trim();

        Page<MediaFile> resultPage = mediaFileRepository.adminSearchStorageObjects(
                normalizedStatus,
                normalizedKeyword,
                PageRequest.of(safePage, safeSize, parseSort(sort)));

        List<MediaFile> rows = resultPage.getContent();
        if (rows.isEmpty()) {
            return new PageResponse<>(
                    List.of(),
                    resultPage.getNumber(),
                    resultPage.getSize(),
                    resultPage.getTotalElements(),
                    resultPage.getTotalPages());
        }

        Map<UUID, User> usersById = batchLoadUsers(rows);
        Set<UUID> linkedMediaFileIds = batchLoadLinkedMediaIds(rows);

        List<AdminStorageObjectResponse> content = rows.stream()
                .map(mf -> toObjectResponse(mf, usersById.get(mf.getUploaded_by()),
                        linkedMediaFileIds.contains(mf.getId())))
                .toList();

        return new PageResponse<>(
                content,
                resultPage.getNumber(),
                resultPage.getSize(),
                resultPage.getTotalElements(),
                resultPage.getTotalPages());
    }

    @Override
    @Transactional(readOnly = true)
    public List<MinioObjectSummary> listOrphanObjects() {
        List<MediaFile> mediaFiles = mediaFileRepository.findAll();
        List<PendingMediaUpload> pendingUploads = pendingUploadRepository.findAll();
        List<UploadSession> uploadSessions = uploadSessionRepository.findAll();
        return scanMinioSafely(mediaFiles, pendingUploads, uploadSessions).orphans;
    }

    @Override
    @Transactional
    public StorageCleanupResponse runCleanup(StorageCleanupTaskType taskType) {
        if (taskType == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_CLEANUP_TASK", "Loại tác vụ không hợp lệ");
        }

        return switch (taskType) {
            case EXPIRED_TRASH -> cleanupExpiredTrash();
            case STALE_PENDING_UPLOADS -> cleanupStalePendingUploads();
            case CANCELLED_CHUNK_SESSIONS -> cleanupCancelledChunkSessions();
            case ORPHAN_MINIO_OBJECTS -> cleanupOrphanMinioObjects();
            case ALL_SAFE -> runAllSafeCleanups();
        };
    }

    @Override
    @Transactional
    public void deleteStorageObject(UUID mediaFileId, boolean force) {
        MediaFile mediaFile = mediaFileRepository.findById(mediaFileId)
                .orElseThrow(() -> new ResourceNotFoundException("MEDIA_NOT_FOUND", "Không tìm thấy MediaFile"));

        if (!force) {
            if (MediaFileStatus.UPLOADING.equals(mediaFile.getStatus())) {
                throw new BusinessException(
                        HttpStatus.CONFLICT,
                        "MEDIA_UPLOADING_ACTIVE",
                        "File đang trong quá trình tải lên. Bật force delete nếu bạn chắc chắn muốn xóa.");
            }
            if (meetingRepository.findByMediaFileId(mediaFileId).isPresent()) {
                throw new BusinessException(
                        HttpStatus.CONFLICT,
                        "MEDIA_LINKED_TO_MEETING",
                        "File đang gắn với một cuộc họp. Xác nhận force delete để xóa cả cuộc họp liên quan.");
            }
        }

        trashService.deleteMinioThenDatabase(mediaFile);
    }

    @Override
    public StorageCleanupResponse deleteOrphanObjects(List<String> objectKeys) {
        if (objectKeys == null || objectKeys.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "EMPTY_OBJECT_KEYS", "Danh sách objectKey trống");
        }
        if (!minioService.isBucketHealthy()) {
            throw new MinioOperationException("MinIO hiện không khả dụng để xóa orphan object", null);
        }

        Set<String> orphanKeyMap = new HashSet<>();
        Map<String, Long> sizeByKey = new HashMap<>();
        for (MinioObjectSummary orphan : listOrphanObjects()) {
            orphanKeyMap.add(orphan.objectKey());
            sizeByKey.put(orphan.objectKey(), orphan.sizeBytes());
        }

        int processed = 0;
        int deleted = 0;
        int failed = 0;
        long freedBytes = 0L;
        List<String> errors = new ArrayList<>();

        for (String key : objectKeys) {
            if (key == null || key.isBlank()) {
                continue;
            }
            processed++;
            if (!orphanKeyMap.contains(key)) {
                failed++;
                errors.add("Bỏ qua key không còn là orphan (đang được tham chiếu): " + key);
                continue;
            }
            try {
                minioService.delete(key);
                deleted++;
                freedBytes += sizeByKey.getOrDefault(key, 0L);
            } catch (Exception ex) {
                failed++;
                errors.add("Xóa thất bại " + key + ": " + ex.getMessage());
                log.warn("Admin delete orphan object failed key={}", key, ex);
            }
        }

        return new StorageCleanupResponse(
                StorageCleanupTaskType.ORPHAN_MINIO_OBJECTS,
                processed,
                deleted,
                failed,
                freedBytes,
                Instant.now(),
                String.format("Đã xóa %d/%d orphan object trên MinIO", deleted, processed),
                errors);
    }

    private StorageCleanupResponse cleanupExpiredTrash() {
        List<MediaFile> expired = mediaFileRepository.findExpiredTrash(MediaFileStatus.TRASHED, Instant.now());
        int processed = expired.size();
        int deleted = 0;
        int failed = 0;
        long freedBytes = 0L;
        List<String> errors = new ArrayList<>();

        for (MediaFile mf : expired) {
            try {
                long size = safeSize(mf.getFile_size_bytes());
                trashService.deleteMinioThenDatabase(mf);
                deleted++;
                freedBytes += size;
            } catch (Exception ex) {
                failed++;
                errors.add("MediaFile " + mf.getId() + ": " + ex.getMessage());
                log.warn("Cleanup expired trash failed for mediaFileId={}", mf.getId(), ex);
            }
        }

        return new StorageCleanupResponse(
                StorageCleanupTaskType.EXPIRED_TRASH,
                processed,
                deleted,
                failed,
                freedBytes,
                Instant.now(),
                String.format("Đã dọn %d/%d file hết hạn trong thùng rác", deleted, processed),
                errors);
    }

    private StorageCleanupResponse cleanupStalePendingUploads() {
        List<PendingMediaUpload> expiredPending = pendingUploadRepository
                .findTop100ByStatusAndExpiresAtBeforeOrderByExpiresAtAsc("PENDING", Instant.now());
        int processed = expiredPending.size();
        int deleted = 0;
        int failed = 0;
        long freedBytes = 0L;
        List<String> errors = new ArrayList<>();

        for (PendingMediaUpload pending : expiredPending) {
            try {
                if (minioService.objectExists(pending.getObjectKey())) {
                    minioService.delete(pending.getObjectKey());
                }
                pending.setStatus("CANCELLED");
                pendingUploadRepository.save(pending);
                deleted++;
                freedBytes += safeSize(pending.getFileSizeBytes());
            } catch (Exception ex) {
                failed++;
                errors.add("PendingUpload " + pending.getId() + ": " + ex.getMessage());
                log.warn("Cleanup stale pending upload failed id={}", pending.getId(), ex);
            }
        }

        return new StorageCleanupResponse(
                StorageCleanupTaskType.STALE_PENDING_UPLOADS,
                processed,
                deleted,
                failed,
                freedBytes,
                Instant.now(),
                String.format("Đã dọn %d/%d pending upload quá hạn", deleted, processed),
                errors);
    }

    private StorageCleanupResponse cleanupCancelledChunkSessions() {
        List<UploadSession> cancelledSessions = uploadSessionRepository
                .findTop100ByStatusAndUpdatedAtBeforeOrderByUpdatedAtAsc(
                        UploadSessionStatus.CANCELLED, Instant.now());
        int processed = cancelledSessions.size();
        int deleted = 0;
        int failed = 0;
        List<String> errors = new ArrayList<>();

        for (UploadSession session : cancelledSessions) {
            try {
                boolean cleaned = chunkMergeAsyncService.cleanupCancelledSession(
                        session.getId(),
                        session.getTotalChunks() != null ? session.getTotalChunks() : 0);
                if (!cleaned) {
                    failed++;
                    errors.add("Session " + session.getId() + ": còn chunk tạm chưa xóa hết trên MinIO");
                    continue;
                }
                uploadSessionRedisService.delete(session.getId());
                uploadSessionRepository.delete(session);
                deleted++;
            } catch (Exception ex) {
                failed++;
                errors.add("Session " + session.getId() + ": " + ex.getMessage());
                log.warn("Cleanup cancelled session failed id={}", session.getId(), ex);
            }
        }

        return new StorageCleanupResponse(
                StorageCleanupTaskType.CANCELLED_CHUNK_SESSIONS,
                processed,
                deleted,
                failed,
                0L,
                Instant.now(),
                String.format("Đã dọn %d/%d upload session đã hủy", deleted, processed),
                errors);
    }

    private StorageCleanupResponse cleanupOrphanMinioObjects() {
        if (!minioService.isBucketHealthy()) {
            return new StorageCleanupResponse(
                    StorageCleanupTaskType.ORPHAN_MINIO_OBJECTS,
                    0,
                    0,
                    1,
                    0L,
                    Instant.now(),
                    "MinIO không khả dụng, bỏ qua dọn orphan objects",
                    List.of("MinIO bucket health check failed"));
        }

        List<MinioObjectSummary> orphans = listOrphanObjects();
        int processed = orphans.size();
        int deleted = 0;
        int failed = 0;
        long freedBytes = 0L;
        List<String> errors = new ArrayList<>();

        for (MinioObjectSummary orphan : orphans) {
            try {
                minioService.delete(orphan.objectKey());
                deleted++;
                freedBytes += orphan.sizeBytes();
            } catch (Exception ex) {
                failed++;
                errors.add("Object " + orphan.objectKey() + ": " + ex.getMessage());
                log.warn("Cleanup orphan MinIO object failed key={}", orphan.objectKey(), ex);
            }
        }

        return new StorageCleanupResponse(
                StorageCleanupTaskType.ORPHAN_MINIO_OBJECTS,
                processed,
                deleted,
                failed,
                freedBytes,
                Instant.now(),
                String.format("Đã dọn %d/%d orphan object trên MinIO", deleted, processed),
                errors);
    }

    private StorageCleanupResponse runAllSafeCleanups() {
        List<StorageCleanupResponse> results = List.of(
                cleanupExpiredTrash(),
                cleanupStalePendingUploads(),
                cleanupCancelledChunkSessions(),
                cleanupOrphanMinioObjects());

        int processed = results.stream().mapToInt(StorageCleanupResponse::processedCount).sum();
        int deleted = results.stream().mapToInt(StorageCleanupResponse::deletedCount).sum();
        int failed = results.stream().mapToInt(StorageCleanupResponse::failedCount).sum();
        long freedBytes = results.stream().mapToLong(StorageCleanupResponse::freedBytes).sum();
        List<String> errors = results.stream()
                .flatMap(res -> res.errors().stream())
                .toList();

        return new StorageCleanupResponse(
                StorageCleanupTaskType.ALL_SAFE,
                processed,
                deleted,
                failed,
                freedBytes,
                Instant.now(),
                String.format("Đã chạy toàn bộ tác vụ dọn dẹp an toàn: %d/%d mục thành công", deleted, processed),
                errors);
    }

    private MinioScanResult scanMinioSafely(
            List<MediaFile> mediaFiles,
            List<PendingMediaUpload> pendingUploads,
            List<UploadSession> uploadSessions) {
        try {
            boolean healthy = minioService.isBucketHealthy();
            if (!healthy) {
                return new MinioScanResult(
                        false,
                        false,
                        "MinIO chưa kết nối hoặc bucket '" + minioService.getBucketName() + "' chưa sẵn sàng.",
                        0L,
                        0L,
                        List.of(),
                        0L);
            }

            List<MinioObjectSummary> objects = minioService.listObjectsSummary(MAX_MINIO_SCAN_OBJECTS);
            Set<String> knownKeys = new HashSet<>();
            for (MediaFile mf : mediaFiles) {
                if (mf.getObject_key() != null) {
                    knownKeys.add(mf.getObject_key());
                }
            }
            for (PendingMediaUpload pending : pendingUploads) {
                if ("PENDING".equals(pending.getStatus()) && pending.getObjectKey() != null) {
                    knownKeys.add(pending.getObjectKey());
                }
            }
            List<String> activeSessionPrefixes = uploadSessions.stream()
                    .filter(s -> s.getStatus() != null && !TERMINAL_SESSION_STATUSES.contains(s.getStatus()))
                    .map(s -> "tmp/" + s.getId() + "/")
                    .toList();

            long minioTotalSize = 0L;
            long orphanTotalSize = 0L;
            List<MinioObjectSummary> orphans = new ArrayList<>();

            for (MinioObjectSummary item : objects) {
                minioTotalSize += item.sizeBytes();
                boolean referencedByDb = knownKeys.contains(item.objectKey());
                boolean belongsToActiveSession = activeSessionPrefixes.stream()
                        .anyMatch(prefix -> item.objectKey().startsWith(prefix));
                if (!referencedByDb && !belongsToActiveSession) {
                    orphans.add(item);
                    orphanTotalSize += item.sizeBytes();
                }
            }

            return new MinioScanResult(
                    true,
                    true,
                    null,
                    objects.size(),
                    minioTotalSize,
                    orphans,
                    orphanTotalSize);
        } catch (Exception ex) {
            log.warn("MinIO scan failed; degrading overview gracefully", ex);
            return new MinioScanResult(
                    false,
                    false,
                    "Không thể quét MinIO bucket: " + ex.getMessage(),
                    0L,
                    0L,
                    List.of(),
                    0L);
        }
    }

    private Map<UUID, User> batchLoadUsers(List<MediaFile> mediaFiles) {
        Set<UUID> userIds = mediaFiles.stream()
                .map(MediaFile::getUploaded_by)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (userIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, User> users = new HashMap<>();
        userRepository.findAllById(userIds).forEach(user -> users.put(user.getId(), user));
        return users;
    }

    private Set<UUID> batchLoadLinkedMediaIds(List<MediaFile> mediaFiles) {
        Collection<UUID> ids = mediaFiles.stream()
                .map(MediaFile::getId)
                .filter(Objects::nonNull)
                .toList();
        if (ids.isEmpty()) {
            return Set.of();
        }
        return new HashSet<>(meetingRepository.findLinkedMediaFileIds(ids));
    }

    private AdminStorageObjectResponse toObjectResponse(
            MediaFile mf,
            User uploader,
            boolean hasLinkedMeeting) {
        return new AdminStorageObjectResponse(
                mf.getId(),
                mf.getWorkspace_id(),
                mf.getUploaded_by(),
                uploader != null ? uploader.getFull_name() : null,
                uploader != null ? uploader.getEmail() : null,
                mf.getOriginal_name(),
                mf.getObject_key(),
                mf.getMime_type(),
                safeSize(mf.getFile_size_bytes()),
                mf.getDuration_seconds(),
                mf.getStatus(),
                mf.getPrevious_status(),
                hasLinkedMeeting,
                mf.getCreated_at(),
                mf.getDeleted_at(),
                mf.getPurge_at());
    }

    private Map<LocalDate, long[]> initializeDailyTrend(Instant now) {
        LocalDate todayUtc = now.atZone(ZoneOffset.UTC).toLocalDate();
        Map<LocalDate, long[]> map = new LinkedHashMap<>();
        for (int offset = TREND_DAYS - 1; offset >= 0; offset--) {
            map.put(todayUtc.minusDays(offset), new long[] {0L, 0L});
        }
        return map;
    }

    private String categorizeMime(String mimeType) {
        if (mimeType == null) {
            return "Other";
        }
        String normalized = mimeType.toLowerCase(Locale.ROOT);
        if (normalized.startsWith("audio/")) {
            return "Audio";
        }
        if (normalized.startsWith("video/")) {
            return "Video";
        }
        return "Other";
    }

    private String normalizeFilterStatus(String status) {
        if (status == null || status.isBlank() || "ALL".equalsIgnoreCase(status.trim())) {
            return null;
        }
        return status.trim().toUpperCase(Locale.ROOT);
    }

    private Sort parseSort(String sort) {
        String raw = sort == null || sort.isBlank() ? "created_at,desc" : sort.trim();
        String[] parts = raw.split(",", -1);
        String field = parts[0].trim();
        if (!ALLOWED_SORT_FIELDS.contains(field)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_SORT", "Trường sort không được hỗ trợ");
        }
        Sort.Direction direction = parts.length > 1 && "asc".equalsIgnoreCase(parts[1].trim())
                ? Sort.Direction.ASC
                : Sort.Direction.DESC;
        return Sort.by(direction, field);
    }

    private long safeSize(Long value) {
        return value == null || value < 0 ? 0L : value;
    }

    private record MinioScanResult(
            boolean connected,
            boolean bucketHealthy,
            String warning,
            long minioObjectCount,
            long minioTotalSizeBytes,
            List<MinioObjectSummary> orphans,
            long orphanTotalSizeBytes
    ) {
    }
}

