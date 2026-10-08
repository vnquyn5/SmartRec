package com.example.smartrec.service.impl;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.core.task.TaskExecutor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.FileUploadResponse;
import com.example.smartrec.model.dto.SimpleUploadCompleteRequest;
import com.example.smartrec.model.dto.SimpleUploadPresignRequest;
import com.example.smartrec.model.dto.SimpleUploadPresignResponse;
import com.example.smartrec.model.dto.UploadDuplicateCheckRequest;
import com.example.smartrec.model.dto.UploadDuplicateCheckResponse;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.FileService;
import com.example.smartrec.service.FileChecksumService;
import com.example.smartrec.service.MinioService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class FileServiceImpl implements FileService {
    private static final int CURRENT_FINGERPRINT_VERSION = 2;
    private static final Logger log = LoggerFactory.getLogger(FileServiceImpl.class);

    private static final long MAX_FILE_SIZE = 2L * 1024 * 1024 * 1024;
    private static final int SIMPLE_UPLOAD_PRESIGN_EXPIRES_SECONDS = 20 * 60;

    private final MediaFileRepository mediaFileRepository;
    private final MeetingRepository meetingRepository;
    private final UserRepository userRepository;
    private final MinioService minioService;
    private final FileChecksumService fileChecksumService;
    private final TaskExecutor applicationTaskExecutor;
    @Override
    @Transactional
    public FileUploadResponse upLoadFile(MultipartFile file, String title) {
        long totalStartNanos = System.nanoTime();
        validateFile(file);
        String originalName = file.getOriginalFilename();
        String safeFileName = sanitizeFileName(originalName);

        User user = getCurrentUser();
        UUID userId = user.getId();
        UUID workspaceId = userId;
        String objectKey = buildObjectKey(user, safeFileName);
        log.info(
                "[simple-upload] prepared fileName={}, safeFileName={}, sizeBytes={}, contentType={}, userId={}, workspaceId={}, objectKey={}",
                originalName,
                safeFileName,
                file.getSize(),
                file.getContentType(),
                userId,
                workspaceId,
                objectKey);

        try {
            long minioStartNanos = System.nanoTime();
            log.info("[simple-upload] MinIO upload start objectKey={}, sizeBytes={}", objectKey, file.getSize());
            minioService.upLoad(file, objectKey);
            log.info("[simple-upload] MinIO upload finish objectKey={}, elapsedMs={}", objectKey,
                    elapsedMs(minioStartNanos));
        } catch (Exception e) {
            log.error("[simple-upload] MinIO upload failed objectKey={}", objectKey, e);
            throw new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, "ERR_MINIO_UNAVAILABLE",
                    "Không thể kết nối hoặc upload file lên MinIO");
        }

        FileUploadResponse response = createUploadRecords(
                workspaceId,
                userId,
                safeFileName,
                objectKey,
                normalizeMimeType(file.getContentType()),
                file.getSize(),
                title,
                null,
                null);
        log.info("[simple-upload] service finished mediaFileId={}, meetingId={}, totalMs={}",
                response.getId(), response.getMeetingId(), elapsedMs(totalStartNanos));
        return response;
    }

    @Override
    public SimpleUploadPresignResponse presignSimpleUpload(SimpleUploadPresignRequest request) {
        if (request == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Upload request không được null");
        }
        validateSimpleUploadMetadata(request.getFileName(), request.getFileSize(), request.getMimeType());

        User user = getCurrentUser();
        String safeFileName = sanitizeFileName(request.getFileName());
        String objectKey = buildUniqueObjectKey(user, safeFileName);

        try {
            String uploadUrl = minioService.presignPutObject(objectKey, SIMPLE_UPLOAD_PRESIGN_EXPIRES_SECONDS);
            log.info("[simple-upload] presigned PUT URL issued objectKey={}, sizeBytes={}, expiresIn={}",
                    objectKey, request.getFileSize(), SIMPLE_UPLOAD_PRESIGN_EXPIRES_SECONDS);
            return new SimpleUploadPresignResponse(uploadUrl, objectKey, SIMPLE_UPLOAD_PRESIGN_EXPIRES_SECONDS);
        } catch (Exception e) {
            log.error("[simple-upload] failed to presign PUT URL objectKey={}", objectKey, e);
            throw new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, "ERR_MINIO_UNAVAILABLE",
                    "Không thể tạo URL upload lên MinIO");
        }
    }

    @Override
    public UploadDuplicateCheckResponse checkDuplicate(UploadDuplicateCheckRequest request) {
        if (request == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Upload request không được null");
        }
        validateUploadFileIdentity(request.getFileName(), request.getFileSize());

        User user = getCurrentUser();
        String checksumSha256 = normalizeHex(request.getChecksumSha256(), 64, "checksumSha256");
        if (checksumSha256 != null) {
            List<MediaFile> exactMatches = mediaFileRepository.findActiveByUserAndChecksumSha256(
                    user.getId(),
                    checksumSha256);
            if (!exactMatches.isEmpty()) {
                return toDuplicateResponse(exactMatches.get(0));
            }

            return UploadDuplicateCheckResponse.noDuplicate();
        }

        String quickFingerprint = normalizeHex(request.getQuickFingerprint(), 64, "quickFingerprint");
        if (quickFingerprint != null) {
            int fingerprintVersion = request.getFingerprintVersion() == null
                    ? CURRENT_FINGERPRINT_VERSION : request.getFingerprintVersion();
            List<MediaFile> candidates = mediaFileRepository.findActiveByUserAndQuickFingerprintVersion(
                    user.getId(),
                    quickFingerprint,
                    fingerprintVersion);
            if (!candidates.isEmpty()) {
                return toDuplicateResponse(candidates.get(0));
            }
            return UploadDuplicateCheckResponse.noDuplicate();
        }

        return UploadDuplicateCheckResponse.noDuplicate();
    }

    @Override
    @Transactional
    public FileUploadResponse completeSimpleUpload(SimpleUploadCompleteRequest request) {
        CompleteTiming timing = new CompleteTiming(
                request == null ? null : request.getObjectKey(),
                request == null ? null : request.getFileSize());
        boolean logAfterTransaction = TransactionSynchronizationManager.isSynchronizationActive();
        if (logAfterTransaction) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    timing.logAfterTransactionCompletion();
                }
            });
        }
        try {
            long validateStartNanos = System.nanoTime();
            if (request == null) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Upload request không được null");
            }
            validateSimpleUploadMetadata(request.getFileName(), request.getFileSize(), request.getMimeType());

            User user = getCurrentUser();
            UUID userId = user.getId();
            UUID workspaceId = userId;
            String safeFileName = sanitizeFileName(request.getFileName());
            String expectedObjectPrefix = buildUserObjectPrefix(user);
            log.info(
                    "[simple-upload] complete received objectKey={}, expectedObjectPrefix={}, fileName={}, safeFileName={}, requestFileSize={}, mimeType={}, titlePresent={}, userId={}, workspaceId={}",
                    request.getObjectKey(), expectedObjectPrefix, request.getFileName(), safeFileName,
                    request.getFileSize(), request.getMimeType(),
                    request.getTitle() != null && !request.getTitle().isBlank(), userId, workspaceId);
            if (!isValidSimpleUploadObjectKey(request.getObjectKey(), expectedObjectPrefix, safeFileName)) {
                log.warn("[simple-upload] complete rejected objectKey mismatch received={}, expectedPrefix={}, safeFileName={}, userId={}",
                        request.getObjectKey(), expectedObjectPrefix, safeFileName, userId);
                throw new BusinessException(HttpStatus.FORBIDDEN, "INVALID_OBJECT_KEY",
                        "Object key không thuộc upload hiện tại");
            }
            timing.validateObjectMs = elapsedMs(validateStartNanos);

            long quickFingerprintStartNanos = System.nanoTime();
            String quickFingerprint = normalizeHex(request.getQuickFingerprint(), 64, "quickFingerprint");
            int fingerprintVersion = request.getFingerprintVersion() == null
                    ? CURRENT_FINGERPRINT_VERSION : request.getFingerprintVersion();
            if (quickFingerprint != null && fingerprintVersion != CURRENT_FINGERPRINT_VERSION) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_FINGERPRINT_VERSION",
                        "Fingerprint version không được hỗ trợ");
            }
            timing.quickFingerprintMs = elapsedMs(quickFingerprintStartNanos);

            long idempotencyStartNanos = System.nanoTime();
            FileUploadResponse existing = findExistingUploadResponse(
                    request.getObjectKey(), userId, quickFingerprint, fingerprintVersion);
            timing.idempotencyLookupMs = elapsedMs(idempotencyStartNanos);
            timing.databaseMs += timing.idempotencyLookupMs;
            if (existing != null) {
                return existing;
            }

            long statStartNanos = System.nanoTime();
            long objectSize;
            try {
                objectSize = minioService.getObjectSize(request.getObjectKey());
            } catch (Exception e) {
                log.error("[simple-upload] complete statObject failed objectKey={}", request.getObjectKey(), e);
                throw new BusinessException(HttpStatus.BAD_REQUEST, "OBJECT_NOT_FOUND",
                        "Không tìm thấy object đã upload trên MinIO");
            }
            timing.minioStatMs = elapsedMs(statStartNanos);
            long verifyStartNanos = System.nanoTime();
            if (objectSize != request.getFileSize()) {
                log.warn("[simple-upload] complete rejected size mismatch objectKey={}, statSizeBytes={}, requestSizeBytes={}",
                        request.getObjectKey(), objectSize, request.getFileSize());
                throw new BusinessException(HttpStatus.BAD_REQUEST, "OBJECT_SIZE_MISMATCH",
                        "Kích thước object trên MinIO không khớp metadata upload");
            }
            timing.verifyObjectMs = elapsedMs(verifyStartNanos);

            String suppliedChecksum = normalizeHex(request.getChecksumSha256(), 64, "checksumSha256");
            String checksumSha256 = suppliedChecksum;
            if (checksumSha256 == null) {
                long shaStartNanos = System.nanoTime();
                timing.minioFullObjectStreams = 1;
                checksumSha256 = fileChecksumService.calculateSha256(request.getObjectKey());
                timing.sha256Ms = elapsedMs(shaStartNanos);
            }

            long duplicateStartNanos = System.nanoTime();
            List<MediaFile> checksumDuplicates = mediaFileRepository.findActiveByUserAndChecksumSha256(
                    userId, checksumSha256);
            timing.duplicateCheckMs = elapsedMs(duplicateStartNanos);
            timing.databaseMs += timing.duplicateCheckMs;
            if (!checksumDuplicates.isEmpty()) {
                MediaFile existingByChecksum = checksumDuplicates.get(0);
                deleteUploadedDuplicateObject(request.getObjectKey(), existingByChecksum.getObject_key());
                throw new BusinessException(
                        HttpStatus.CONFLICT,
                        "FILE_ALREADY_EXISTS",
                        "File đã có trong hệ thống: " + existingByChecksum.getOriginal_name());
            }

            FileUploadResponse response = createUploadRecords(
                    workspaceId,
                    userId,
                    safeFileName,
                    request.getObjectKey(),
                    normalizeMimeType(request.getMimeType()),
                    request.getFileSize(),
                    request.getTitle(),
                    checksumSha256,
                    quickFingerprint,
                    timing);
            if (suppliedChecksum != null) {
                UUID mediaFileId = response.getId();
                String finalChecksum = suppliedChecksum;
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        applicationTaskExecutor.execute(() -> verifyClientChecksumAsync(
                                mediaFileId, request.getObjectKey(), finalChecksum));
                    }
                });
            }
            return response;
        } finally {
            if (logAfterTransaction) {
                timing.markServiceExit();
            } else {
                timing.logSummary();
            }
        }
    }

    private void verifyClientChecksumAsync(UUID mediaFileId, String objectKey, String clientChecksum) {
        MediaFile currentMediaFile = mediaFileRepository.findById(mediaFileId).orElse(null);
        if (currentMediaFile == null) return;
        long startedAt = System.nanoTime();
        try {
            String serverChecksum = fileChecksumService.calculateSha256(objectKey);
            List<MediaFile> duplicateRows = mediaFileRepository.findActiveByUserAndChecksumSha256ExcludingId(
                    currentMediaFile.getUploaded_by(),
                    serverChecksum,
                    mediaFileId);
            if (serverChecksum.equalsIgnoreCase(clientChecksum) && duplicateRows.isEmpty()) {
                log.info("[single-upload] background checksum verified mediaFileId={}, objectKey={}, backgroundSha256Ms={}",
                        mediaFileId, objectKey, elapsedMs(startedAt));
                return;
            }
            mediaFileRepository.findById(mediaFileId).ifPresent(mediaFile -> {
                mediaFile.setChecksumSha256(null);
                mediaFile.setQuickFingerprint(null);
                mediaFile.setStatus(MediaFileStatus.INTEGRITY_FAILED);
                mediaFileRepository.save(mediaFile);
                meetingRepository.findByMediaFileId(mediaFileId).ifPresent(meeting -> {
                    meeting.setStatus(MeetingStatus.FAILED);
                    meetingRepository.save(meeting);
                });
                if (!duplicateRows.isEmpty()) {
                    deleteUploadedDuplicateObject(objectKey, duplicateRows.get(0).getObject_key());
                }
            });
            log.error("[single-upload] background checksum validation failed mediaFileId={}, objectKey={}, clientChecksum={}, serverChecksum={}, duplicateMediaFileId={}, backgroundSha256Ms={}",
                    mediaFileId, objectKey, clientChecksum, serverChecksum,
                    duplicateRows.isEmpty() ? null : duplicateRows.get(0).getId(), elapsedMs(startedAt));
        } catch (Exception e) {
            currentMediaFile.setChecksumSha256(null);
            currentMediaFile.setQuickFingerprint(null);
            currentMediaFile.setStatus(MediaFileStatus.INTEGRITY_FAILED);
            mediaFileRepository.save(currentMediaFile);
            log.error("[single-upload] background checksum verification failed mediaFileId={}, objectKey={}, backgroundSha256Ms={}",
                    mediaFileId, objectKey, elapsedMs(startedAt), e);
        }
    }

    private static final class CompleteTiming {
        private final long completeStartNanos = System.nanoTime();
        private final long completeStartEpochMs = System.currentTimeMillis();
        private final String objectKey;
        private final Long fileSize;
        private long validateObjectMs;
        private long idempotencyLookupMs;
        private long minioStatMs;
        private long verifyObjectMs;
        private long durationProbeMs;
        private long quickFingerprintMs;
        private long sha256Ms;
        private long duplicateCheckMs;
        private int minioFullObjectStreams;
        private long mediaFileSaveMs;
        private long meetingSaveMs;
        private long databaseMs;
        private long serviceExitNanos;
        private boolean summaryLogged;

        private CompleteTiming(String objectKey, Long fileSize) {
            this.objectKey = objectKey;
            this.fileSize = fileSize;
        }

        private void logSummary() {
            if (summaryLogged) return;
            summaryLogged = true;
            long totalCompleteMs = elapsedMs(completeStartNanos);
            long measuredMs = validateObjectMs + minioStatMs + quickFingerprintMs + sha256Ms + databaseMs;
            long otherMs = Math.max(0, totalCompleteMs - measuredMs);
            log.info("[single-complete] summary completeStartEpochMs={} objectKey={} fileSize={} statObjectMs={} verifyObjectMs={} sha256Ms={} minioFullObjectStreams={} duplicateQueryMs={} durationProbeMs={} mediaFileSaveMs={} meetingSaveMs={} databaseMs={} totalMs={} validateObjectMs={} idempotencyLookupMs={} quickFingerprintMs={} duplicateCheckMs={} otherMs={}",
                    completeStartEpochMs, objectKey, fileSize, minioStatMs, verifyObjectMs, sha256Ms,
                    minioFullObjectStreams, duplicateCheckMs, durationProbeMs,
                    mediaFileSaveMs, meetingSaveMs, databaseMs, totalCompleteMs,
                    validateObjectMs, idempotencyLookupMs, quickFingerprintMs, duplicateCheckMs, otherMs);
        }

        private void markServiceExit() {
            serviceExitNanos = System.nanoTime();
        }

        private void logAfterTransactionCompletion() {
            if (serviceExitNanos != 0) {
                long transactionCompletionMs = (System.nanoTime() - serviceExitNanos) / 1_000_000;
                databaseMs += transactionCompletionMs;
            }
            logSummary();
        }
    }

    private FileUploadResponse createUploadRecords(
            UUID workspaceId,
            UUID userId,
            String safeFileName,
            String objectKey,
            String mimeType,
            Long fileSize,
            String title,
            String checksumSha256,
            String quickFingerprint) {
        return createUploadRecords(
                workspaceId, userId, safeFileName, objectKey, mimeType, fileSize,
                title, checksumSha256, quickFingerprint, null);
    }

    private FileUploadResponse createUploadRecords(
            UUID workspaceId,
            UUID userId,
            String safeFileName,
            String objectKey,
            String mimeType,
            Long fileSize,
            String title,
            String checksumSha256,
            String quickFingerprint,
            CompleteTiming timing) {
        log.info(
                "[simple-upload] create records start objectKey={}, originalName={}, fileSizeBytes={}, mimeType={}, status={}, uploadedBy={}, workspaceId={}",
                objectKey,
                safeFileName,
                fileSize,
                normalizeMimeType(mimeType),
                MediaFileStatus.UPLOADED,
                userId,
                workspaceId);

        MediaFile mediaFile = MediaFile.builder()
                .workspace_id(workspaceId)
                .uploaded_by(userId)
                .original_name(safeFileName)
                .object_key(objectKey)
                .mime_type(normalizeMimeType(mimeType))
                .file_size_bytes(fileSize)
                .checksumSha256(checksumSha256)
                .quickFingerprint(quickFingerprint)
                .fingerprintVersion(quickFingerprint == null ? null : CURRENT_FINGERPRINT_VERSION)
                .status(MediaFileStatus.UPLOADED)
                .build();
        MediaFile savedMediaFile;
        long mediaFileSaveStartNanos = System.nanoTime();
        try {
            savedMediaFile = mediaFileRepository.saveAndFlush(mediaFile);
            log.info("[simple-upload] MediaFile DB save success mediaFileId={}, objectKey={}, elapsedMs={}",
                    savedMediaFile.getId(), objectKey, elapsedMs(mediaFileSaveStartNanos));
        } catch (DataAccessException e) {
            MediaFile existingDuplicate = findChecksumDuplicate(userId, checksumSha256);
            if (existingDuplicate != null) {
                deleteUploadedDuplicateObject(objectKey, existingDuplicate.getObject_key());
                throw new BusinessException(
                        HttpStatus.CONFLICT,
                        "FILE_ALREADY_EXISTS",
                        "File đã có trong hệ thống: " + existingDuplicate.getOriginal_name());
            }
            log.error(
                    "[simple-upload] MediaFile DB save failed objectKey={}, originalName={}, fileSizeBytes={}, mimeType={}, status={}, uploadedBy={}, workspaceId={}",
                    objectKey,
                    safeFileName,
                    fileSize,
                    normalizeMimeType(mimeType),
                    MediaFileStatus.UPLOADED,
                    userId,
                    workspaceId,
                    e);
            throw e;
        } finally {
            if (timing != null) {
                timing.mediaFileSaveMs = elapsedMs(mediaFileSaveStartNanos);
                timing.databaseMs += timing.mediaFileSaveMs;
            }
        }

        long meetingSaveStartNanos = System.nanoTime();
        Meeting meeting = Meeting.builder()
                .workspace_id(workspaceId)
                .media_file_id(savedMediaFile.getId())
                .title(title == null || title.isBlank() ? safeFileName : title)
                .status(MeetingStatus.UNPROCESSED)
                .build();
        Meeting savedMeeting;
        try {
            savedMeeting = meetingRepository.saveAndFlush(meeting);
            log.info("[simple-upload] Meeting DB save success meetingId={}, mediaFileId={}, workspaceId={}, title={}, status={}, elapsedMs={}",
                    savedMeeting.getId(),
                    savedMediaFile.getId(),
                    workspaceId,
                    meeting.getTitle(),
                    MeetingStatus.UNPROCESSED,
                    elapsedMs(meetingSaveStartNanos));
        } catch (DataAccessException e) {
            log.error(
                    "[simple-upload] Meeting DB save failed mediaFileId={}, workspaceId={}, title={}, status={}",
                    savedMediaFile.getId(),
                    workspaceId,
                    meeting.getTitle(),
                    MeetingStatus.UNPROCESSED,
                    e);
            throw e;
        } finally {
            if (timing != null) {
                timing.meetingSaveMs = elapsedMs(meetingSaveStartNanos);
                timing.databaseMs += timing.meetingSaveMs;
            }
        }

        return toFileUploadResponse(savedMediaFile, savedMeeting);
    }

    private void deleteUploadedDuplicateObject(String uploadedObjectKey, String existingObjectKey) {
        if (uploadedObjectKey == null || uploadedObjectKey.equals(existingObjectKey)) {
            return;
        }
        try {
            minioService.delete(uploadedObjectKey);
        } catch (Exception e) {
            log.warn("[simple-upload] could not delete duplicate uploaded object objectKey={}", uploadedObjectKey, e);
        }
    }

    private MediaFile findChecksumDuplicate(UUID userId, String checksumSha256) {
        if (checksumSha256 == null || checksumSha256.isBlank()) {
            return null;
        }
        List<MediaFile> duplicates = mediaFileRepository.findActiveByUserAndChecksumSha256(userId, checksumSha256);
        return duplicates.isEmpty() ? null : duplicates.get(0);
    }

    private FileUploadResponse findExistingUploadResponse(
            String objectKey, UUID userId, String quickFingerprint, int fingerprintVersion) {
        List<MediaFile> mediaFiles = mediaFileRepository.findAllByObjectKey(objectKey);
        if (mediaFiles.isEmpty()) {
            log.info("[simple-upload] complete idempotency lookup miss objectKey={}", objectKey);
            return null;
        }

        log.info("[simple-upload] complete idempotency lookup hit objectKey={}, mediaFileCount={}",
                objectKey, mediaFiles.size());
        MediaFile mediaFile = mediaFiles.stream()
                .filter(item -> userId.equals(item.getUploaded_by()))
                .findFirst()
                .orElseThrow(() -> new BusinessException(HttpStatus.FORBIDDEN, "INVALID_OBJECT_KEY",
                        "Object key không thuộc người dùng hiện tại"));

        // An older/recovered completion may omit metadata. Only fill missing
        // fields; never replace an existing fingerprint or its version.
        if (quickFingerprint != null) {
            boolean changed = false;
            if (mediaFile.getQuickFingerprint() == null
                    && (mediaFile.getFingerprintVersion() == null
                        || mediaFile.getFingerprintVersion() == fingerprintVersion)) {
                mediaFile.setQuickFingerprint(quickFingerprint);
                changed = true;
            }
            if (mediaFile.getFingerprintVersion() == null
                    && quickFingerprint.equals(mediaFile.getQuickFingerprint())) {
                mediaFile.setFingerprintVersion(fingerprintVersion);
                changed = true;
            }
            if (changed) mediaFileRepository.save(mediaFile);
        }

        Meeting meeting = meetingRepository.findByMediaFileId(mediaFile.getId())
                .orElseGet(() -> {
                    long meetingSaveStartNanos = System.nanoTime();
                    log.warn("[simple-upload] complete repairing missing Meeting for mediaFileId={}, objectKey={}",
                            mediaFile.getId(), objectKey);
                    Meeting repairedMeeting = meetingRepository.saveAndFlush(Meeting.builder()
                            .workspace_id(mediaFile.getWorkspace_id())
                            .media_file_id(mediaFile.getId())
                            .title(mediaFile.getOriginal_name())
                            .status(MeetingStatus.UNPROCESSED)
                            .build());
                    log.info("[simple-upload] complete repaired Meeting meetingId={}, mediaFileId={}, elapsedMs={}",
                            repairedMeeting.getId(), mediaFile.getId(), elapsedMs(meetingSaveStartNanos));
                    return repairedMeeting;
                });
        return toFileUploadResponse(mediaFile, meeting);
    }

    private FileUploadResponse toFileUploadResponse(MediaFile mediaFile, Meeting meeting) {
        return new FileUploadResponse(
                mediaFile.getId(),
                meeting.getId(),
                mediaFile.getOriginal_name(),
                mediaFile.getObject_key(),
                mediaFile.getMime_type(),
                mediaFile.getFile_size_bytes(),
                mediaFile.getDuration_seconds(),
                mediaFile.getStatus(),
                meeting.getStatus().name());
    }

    private void validateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_FILE_EMPTY", "File không được để trống ");
        }
        validateSimpleUploadMetadata(file.getOriginalFilename(), file.getSize(), file.getContentType());
    }

    private void validateSimpleUploadMetadata(String fileName, Long fileSize, String mimeType) {
        validateUploadFileIdentity(fileName, fileSize);
        if (fileSize > MAX_FILE_SIZE) {
            throw new BusinessException(HttpStatus.PAYLOAD_TOO_LARGE, "ERR_FILE_TOO_LARGE", "File không vượt quá 2GB");
        }
        normalizeMimeType(mimeType);
    }

    private UploadDuplicateCheckResponse toDuplicateResponse(MediaFile existing) {
        return UploadDuplicateCheckResponse.exactDuplicate(
                existing.getId(),
                existing.getOriginal_name(),
                existing.getFile_size_bytes(),
                existing.getObject_key());
    }

    private String normalizeHex(String value, int expectedLength, String fieldName) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.trim().toLowerCase();
        if (normalized.length() != expectedLength || !normalized.matches("[0-9a-f]+")) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_" + fieldName.toUpperCase(),
                    fieldName + " không hợp lệ");
        }
        return normalized;
    }

    private void validateUploadFileIdentity(String fileName, Long fileSize) {
        if (fileSize == null || fileSize <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_FILE_EMPTY", "File không được để trống ");
        }
        if (fileName == null || fileName.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_INVALID_FILENAME", "Tên file không hợp lệ");
        }
        String lowerName = fileName.toLowerCase();
        boolean validExtension = lowerName.endsWith(".mp4") || lowerName.endsWith(".mkv") ||
                lowerName.endsWith(".mp3") || lowerName.endsWith(".m4a");

        if (!validExtension) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_INVALID_FILE_TYPE",
                    "Chỉ hổ trợ file .mp4, .mkv, .mp3, .m4a");
        }
    }

    private String buildObjectKey(User user, String safeFileName) {
        return buildUserObjectPrefix(user) + safeFileName;
    }

    private String buildUniqueObjectKey(User user, String safeFileName) {
        return buildUserObjectPrefix(user) + UUID.randomUUID() + "_" + safeFileName;
    }

    private String buildUserObjectPrefix(User user) {
        String accountName = sanitizeAccountName(user.getFull_name());
        LocalDate now = LocalDate.now();
        return accountName
                + "/"
                + String.format("%02d", now.getMonthValue())
                + "-" + now.getYear()
                + "/";
    }

    private boolean isValidSimpleUploadObjectKey(String objectKey, String expectedPrefix, String safeFileName) {
        if (objectKey == null || objectKey.isBlank()) {
            return false;
        }
        return objectKey.startsWith(expectedPrefix)
                && (objectKey.endsWith("/" + safeFileName) || objectKey.endsWith("_" + safeFileName));
    }

    private String normalizeMimeType(String mimeType) {
        return mimeType == null || mimeType.isBlank() ? "application/octet-stream" : mimeType;
    }

    private String sanitizeFileName(String fileName) {
        return fileName
                .replace("\\", "_")
                .replace("/", "_")
                .replace("..", "_")
                .replaceAll(
                        "[^a-zA-Z0-9._-]",
                        "_");
    }

    private String sanitizeAccountName(String accountName) {
        if (accountName == null || accountName.isBlank()) {
            return "unknown_user";
        }

        return accountName.trim().replaceAll("[\\\\/:*?\"<>|]", "");
    }

    private User getCurrentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Yêu cầu đăng nhập");
        }

        String identifier = authentication.getName();
        return userRepository.findByEmail(identifier)
                .or(() -> userRepository.findByPhone(identifier))
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.UNAUTHORIZED,
                        "USER_NOT_FOUND",
                        "Không tìm thấy người dùng đăng nhập"));
    }

    private static long elapsedMs(long startedAtNanos) {
        return (System.nanoTime() - startedAtNanos) / 1_000_000;
    }
}
