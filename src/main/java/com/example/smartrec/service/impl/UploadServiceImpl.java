package com.example.smartrec.service.impl;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.UploadSessionStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.UploadSession;
import com.example.smartrec.model.dto.ChunkUploadRequest;
import com.example.smartrec.model.dto.ChunkUploadResponse;
import com.example.smartrec.model.dto.MergeUploadReponse;
import com.example.smartrec.model.dto.MergeUploadRequest;
import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;
import com.example.smartrec.model.dto.UploadSessionStatusResponse;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UploadSessionRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.ChunkMergeAsyncService;
import com.example.smartrec.service.ChunkMergeAsyncService.MergeJob;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.UploadService;
import com.example.smartrec.service.UploadSessionRedisService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class UploadServiceImpl implements UploadService {
        private static final Logger log = LoggerFactory.getLogger(UploadServiceImpl.class);
        private static final Map<UUID, Object> UPLOAD_SESSION_LOCKS = new ConcurrentHashMap<>();
        private static final Set<UUID> FINALIZATION_IN_FLIGHT = ConcurrentHashMap.newKeySet();
        private final UserRepository userRepository;
        private final UploadSessionRepository uploadSessionRepository;
        private final MediaFileRepository mediaFileRepository;
        private final MeetingRepository meetingRepository;
        private final UploadSessionRedisService uploadSessionRedisService;
        private final MinioService minioService;
        private final DataSource dataSource;
        private final ChunkMergeAsyncService chunkMergeAsyncService;

        // chunk =5 MB
        private static final long CHUNK_SIZE = 5l * 1024 * 1024;

        private static final Set<String> ALLOWED_EXTENSIONS = Set.of("mp3", "mp4", "m4a", "mkv");


        @Override
        public UploadInitResponse initUpload(UploadInitRequest request) {
                if (request == null) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_REQUEST",
                                        "Upload request không được null");
                }
                User user = getCurrentUser();
                if (request.getQuickFingerprint() != null
                                && request.getFingerprintVersion() != null
                                && request.getFingerprintVersion() != 2) {
                        throw new BusinessException(HttpStatus.BAD_REQUEST,
                                        "UNSUPPORTED_FINGERPRINT_VERSION",
                                        "Fingerprint version không được hỗ trợ");
                }
                String fileName = request.getFileName();
                if (fileName == null || fileName.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "ERR_INVALID_FILENAME",
                                        "Tên file không được để trống");
                }
                fileName = fileName.trim();
                String safeFileName = sanitizeFileName(fileName);

                String extension = getExtension(fileName);
                if (!ALLOWED_EXTENSIONS.contains(extension)) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "ERR_INVALID_FILE_TYPE",
                                        "Chỉ hỗ trợ file .mp4, .mkv, .mp3, .m4a");
                }

                Long fileSize = request.getFileSize();
                if (fileSize == null || fileSize <= 0) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                "ERR_INVALID_FILE_SIZE",
                                "File size phải lớn hơn 0");
                }
                Integer totalChunks = request.getTotalChunks();
                if (totalChunks == null || totalChunks <= 0) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "ERR_INVALID_TOTAL_CHUNKS",
                                        "Total chunks phải lớn hơn 0");
                }

                // Tạo UUID cho upload session
                UUID uploadSessionId = UUID.randomUUID();

                // 8. Tạo UploadSession
                UploadSession session = UploadSession.builder()
                                .uploadSessionId(uploadSessionId)
                                .userId(user.getId())
                                .fileName(safeFileName)
                                .fileSize(fileSize)
                                .totalChunks(totalChunks)
                                .chunkSize(CHUNK_SIZE)
                                .receivedChunks(0)
                                .status(UploadSessionStatus.INITIATED)
                                .quickFingerprint(normalizeHex(request.getQuickFingerprint(), 64, "quickFingerprint"))
                                .build();

                com.example.smartrec.entity.UploadSession persistentSession =
                                com.example.smartrec.entity.UploadSession.builder()
                                                .id(uploadSessionId)
                                                .userId(user.getId())
                                                .totalChunks(totalChunks)
                                                .receivedChunks(0)
                                                .status(UploadSessionStatus.INITIATED)
                                                .build();
                try {
                        logDatasource();
                        log.info("Saving upload session to PostgreSQL: {}", uploadSessionId);
                        uploadSessionRepository.saveAndFlush(persistentSession);
                        log.info("Upload session saved to PostgreSQL: {}", uploadSessionId);
                } catch (Exception e) {
                        log.error("Failed to save upload session to PostgreSQL: {}", uploadSessionId, e);
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "UPLOAD_SESSION_DB_SAVE_FAILED",
                                        "Không thể lưu upload session vào PostgreSQL");
                }

                // luu upload session vao redis
                try {
                        uploadSessionRedisService.save(session);
                } catch (Exception e) {
                        log.error("Failed to save upload session to Redis after PostgreSQL save: {}", uploadSessionId,
                                        e);
                        throw e;
                }
                return UploadInitResponse.builder()
                                .uploadSessionId(uploadSessionId.toString())
                                .chunkSize(CHUNK_SIZE)
                                .totalChunks(totalChunks)
                                .status(UploadSessionStatus.INITIATED.name())
                                .build();

        }

        private void logDatasource() {
                try (Connection connection = dataSource.getConnection()) {
                        DatabaseMetaData metaData = connection.getMetaData();
                        log.info("UploadSession PostgreSQL datasource: url={}, user={}",
                                        metaData.getURL(),
                                        metaData.getUserName());
                } catch (Exception e) {
                        log.warn("Could not read datasource metadata for upload session save", e);
                }
        }

        private User getCurrentUser() {

                Authentication authentication = SecurityContextHolder
                                .getContext()
                                .getAuthentication();

                if (authentication == null
                                || !authentication.isAuthenticated()) {

                        throw new BusinessException(
                                        HttpStatus.UNAUTHORIZED,
                                        "UNAUTHORIZED",
                                        "Yêu cầu đăng nhập");
                }

                String identifier = authentication.getName();

                return userRepository.findByEmail(identifier)
                                .or(() -> userRepository.findByPhone(identifier))
                                .orElseThrow(() -> new BusinessException(
                                                HttpStatus.UNAUTHORIZED,
                                                "USER_NOT_FOUND",
                                                "Không tìm thấy người dùng đăng nhập"));
        }

        private String getExtension(String fileName) {

                int lastDot = fileName.lastIndexOf('.');

                if (lastDot == -1 || lastDot == fileName.length() - 1) {
                        return "";
                }

                return fileName
                                .substring(lastDot + 1)
                                .toLowerCase();
        }

        private String sanitizeFileName(String fileName) {
                return fileName
                                .replace("\\", "_")
                                .replace("/", "_")
                                .replace("..", "_")
                                .replaceAll("[^a-zA-Z0-9._-]", "_");
        }

        private String sanitizeAccountName(String accountName) {
                if (accountName == null || accountName.isBlank()) {
                        return "unknown_user";
                }
                return accountName.trim().replaceAll("[\\\\/:*?\"<>|]", "");
        }

        private String buildUserObjectKey(User user, String fileName) {
                String accountName = sanitizeAccountName(user.getFull_name());
                LocalDate now = LocalDate.now();
                return accountName
                                + "/"
                                + String.format("%02d", now.getMonthValue())
                                + "-"
                                + now.getYear()
                                + "/"
                                + sanitizeFileName(fileName);
        }

        private String detectMimeType(String fileName) {
                String extension = getExtension(fileName);
                return switch (extension) {
                        case "mp3" -> "audio/mpeg";
                        case "m4a" -> "audio/mp4";
                        case "mp4" -> "video/mp4";
                        case "mkv" -> "video/x-matroska";
                        default -> "application/octet-stream";
                };
        }

        private UUID parseUploadSessionId(String sessionIdString) {
                if (sessionIdString == null || sessionIdString.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_UPLOAD_SESSION_ID",
                                        "Upload session ID không được để trống");
                }
                try {
                        return UUID.fromString(sessionIdString);
                } catch (IllegalArgumentException e) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_UPLOAD_SESSION_ID",
                                        "Upload session ID không hợp lệ");
                }
        }

        private com.example.smartrec.entity.UploadSession getPersistentSessionForCurrentUser(UUID uploadSessionId) {
                User user = getCurrentUser();
                return uploadSessionRepository.findByIdAndUserId(uploadSessionId, user.getId())
                                .orElseThrow(() -> new BusinessException(
                                                HttpStatus.NOT_FOUND,
                                                "UPLOAD_SESSION_NOT_FOUND",
                                                "Không tìm thấy upload session trong PostgreSQL"));
        }

        private void updatePersistentStatus(String sessionIdString, UploadSessionStatus status) {
                UUID uploadSessionId = parseUploadSessionId(sessionIdString);
                com.example.smartrec.entity.UploadSession persistentSession =
                                getPersistentSessionForCurrentUser(uploadSessionId);
                persistentSession.setStatus(status);
                uploadSessionRepository.save(persistentSession);
        }

        private void syncSessionStatus(
                        UUID uploadSessionId,
                        UploadSession session,
                        UploadSessionStatus status,
                        long redisUploadedCount) {
                UploadSessionStatus oldRedisStatus = session.getStatus();
                session.setStatus(status);
                if (status == UploadSessionStatus.READY_TO_MERGE) {
                        session.setReceivedChunks(session.getTotalChunks());
                }
                uploadSessionRedisService.save(session);
                uploadSessionRepository.findById(uploadSessionId).ifPresent(persistentSession -> {
                        UploadSessionStatus oldPersistentStatus = persistentSession.getStatus();
                        if (status == UploadSessionStatus.READY_TO_MERGE) {
                                persistentSession.setReceivedChunks(persistentSession.getTotalChunks());
                        }
                        persistentSession.setStatus(status);
                        uploadSessionRepository.save(persistentSession);
                        logStatusTransition(
                                        "sync-postgres",
                                        uploadSessionId,
                                        oldPersistentStatus,
                                        persistentSession.getStatus(),
                                        persistentSession.getReceivedChunks(),
                                        persistentSession.getTotalChunks(),
                                        redisUploadedCount);
                });
                logStatusTransition(
                                "sync-redis",
                                uploadSessionId,
                                oldRedisStatus,
                                session.getStatus(),
                                session.getReceivedChunks(),
                                session.getTotalChunks(),
                                redisUploadedCount);
        }

        @Override
        public ChunkUploadResponse uploadChunk(ChunkUploadRequest request) {
                ChunkRequestTiming timing = new ChunkRequestTiming(request);
                try {
                        return uploadChunkInternal(request, timing);
                } catch (Exception e) {
                        safeChunkLog(() -> log.error(
                                        "[chunk-upload] failure session={} chunkIndex={} step={} minioStored={} redisMarked={} accepted={}",
                                        timing.sessionId, timing.chunkIndex, timing.step,
                                        timing.minioStored, timing.accepted, timing.accepted, e));
                        if (timing.accepted) {
                                return ChunkUploadResponse.builder().uploadSessionId(timing.sessionId)
                                                .chunkIndex(timing.chunkIndex).status("SUCCESS")
                                                .message("tmp/" + timing.sessionId + "/chunk_" + timing.chunkIndex).build();
                        }
                        throw e;
                } finally {
                        if (timing.accepted && timing.postAcceptance != null) {
                                timing.postAcceptance.run();
                        }
                        safeChunkLog(timing::logSummary);
                }
        }

        private ChunkUploadResponse uploadChunkInternal(ChunkUploadRequest request, ChunkRequestTiming timing) {
                long totalStartedAt = System.nanoTime();
                long stageStartedAt = totalStartedAt;
                log.info("[chunked-upload] /upload/chunk received uploadSessionId={}, chunkIndex={}",
                                request != null ? request.getUploadSessionId() : null,
                                chunkIndexOrNull(request));
                if (request == null) {
                        throw new BusinessException(HttpStatus.BAD_REQUEST,
                                        "INVALID_REQUEST",
                                        "Chunk upload request không được null");
                }
                String sessionIdString = request.getUploadSessionId();
                if (sessionIdString == null || sessionIdString.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_UPLOAD_SESSION_ID",
                                        "Upload session ID không được để trống");
                }
                UUID uploadSessionId;
                try {
                        uploadSessionId = UUID.fromString(sessionIdString);
                } catch (IllegalArgumentException e) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_UPLOAD_SESSION_ID",
                                        "Upload session ID không hợp lệ");
                }
                User crusUser = getCurrentUser();
                UploadSession session = uploadSessionRedisService.get(uploadSessionId);
                timing.totalChunks = session.getTotalChunks();
                timing.isLastIndex = request.getChunkIndex() != null
                                && request.getChunkIndex() == session.getTotalChunks() - 1;
                long redisCountBeforeUpload = getUploadedChunkCount(uploadSessionId);
                logChunkStage(uploadSessionId, chunkIndexOrNull(request), "session load", stageStartedAt);

                if (!session.getUserId().equals(crusUser.getId())) {
                        throw new BusinessException(
                                        HttpStatus.FORBIDDEN,
                                        "UPLOAD_SESSION_NOT_OWNED",
                                        "Upload session không thuộc người dùng hiện tại");
                }

                Integer chunkIndex = request.getChunkIndex();
                if (chunkIndex == null) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNK_INDEX",
                                        "Chunk index không đc để trống ");
                }

                if (chunkIndex < 0 || chunkIndex >= session.getTotalChunks()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNK_INDEX",
                                        "Chunk index nằm ngoài phạm vi cho phép");
                }

                MultipartFile file = request.getFile();
                if (file == null || file.isEmpty()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNK_FILE",
                                        "Chunk file không đc để trống ");
                }
                if (file.getSize() > session.getChunkSize()) {
                        throw new BusinessException(
                                        HttpStatus.PAYLOAD_TOO_LARGE,
                                        "ERR_CHUNK_TOO_LARGE",
                                        "Chunk vượt quá kích thước cho phép ");
                }
                log.info(
                                "[chunk-upload] start session={} chunkIndex={} totalChunks={} chunkSize={} checksumClient={} status={} redisCountBefore={}",
                                uploadSessionId,
                                chunkIndex,
                                session.getTotalChunks(),
                                file.getSize(),
                                request.getChecksumMD5(),
                                session.getStatus(),
                                redisCountBeforeUpload);

                // tao obj cho chunk
                String objectKey = "tmp/"
                                + uploadSessionId
                                + "/chunk_"
                                + chunkIndex;
                timing.postAcceptance = () -> scheduleAcceptedChunkWork(
                                uploadSessionId, timing.totalChunks, chunkIndex, crusUser, timing);

                // kiem tra chunk da upload chua truoc khi reject theo status de idempotent voi request in-flight
                stageStartedAt = System.nanoTime();
                boolean redisMarkedButMinioMissing = false;
                if (uploadSessionRedisService.isChunkUploaded(uploadSessionId, chunkIndex)) {
                        if (minioService.objectExists(objectKey)) {
                                timing.minioStored = true;
                                timing.accepted = true;
                                log.info("[chunk-upload] success idempotent session={} chunkIndex={} objectKey={}",
                                                uploadSessionId,
                                                chunkIndex,
                                                objectKey);
                                logChunkStage(uploadSessionId, chunkIndex, "Redis/MinIO duplicate idempotent success", stageStartedAt);
                                timing.uploadedCount = getUploadedChunkCount(uploadSessionId);
                                timing.finalizationAllowed = session.getStatus() != UploadSessionStatus.MERGING
                                                && session.getStatus() != UploadSessionStatus.COMPLETED;
                                return ChunkUploadResponse.builder()
                                                .uploadSessionId(sessionIdString)
                                                .chunkIndex(chunkIndex)
                                                .status("SUCCESS")
                                                .message(objectKey)
                                                .build();
                        }
                        log.warn("[chunked-upload] Redis had chunk but MinIO object is missing; re-uploading uploadSessionId={}, chunkIndex={}, objectKey={}",
                                        uploadSessionId,
                                        chunkIndex,
                                        objectKey);
                        redisMarkedButMinioMissing = true;
                }
                logChunkStage(uploadSessionId, chunkIndex, "Redis duplicate check", stageStartedAt);
                log.info("[chunk-upload] duplicate-check session={} chunkIndex={} objectKey={}",
                                uploadSessionId,
                                chunkIndex,
                                objectKey);

                if (session.getStatus() != UploadSessionStatus.INITIATED
                                && session.getStatus() != UploadSessionStatus.UPLOADING
                                && session.getStatus() != UploadSessionStatus.READY_TO_MERGE) {
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "INVALID_UPLOAD_SESSION_STATUS",
                                        "Upload session không ở trạng thái cho phép upload chunk");
                }
                if (session.getStatus() == UploadSessionStatus.READY_TO_MERGE) {
                        long uploadedChunkCount = getUploadedChunkCount(uploadSessionId);
                        if (uploadedChunkCount >= session.getTotalChunks()
                                        && !redisMarkedButMinioMissing) {
                                throw new BusinessException(
                                                HttpStatus.CONFLICT,
                                                "CHUNK_NOT_REGISTERED_AFTER_READY_TO_MERGE",
                                                "Session đã đủ chunk nhưng chunk hiện tại chưa được ghi nhận");
                        }
                        syncSessionStatus(uploadSessionId, session, UploadSessionStatus.UPLOADING, uploadedChunkCount);
                }

                // lay chunksum tu fe gui
                String checksumMD5 = request.getChecksumMD5();
                if (checksumMD5 == null || checksumMD5.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNKSUM",
                                        "Checksum MD5 không được để trống");
                }
                String checksumSha256 = normalizeHex(
                                request.getChecksumSha256(), 64, "checksumSha256");

                String calculatedMD5;
                stageStartedAt = System.nanoTime();
                try {
                        // Tao cong cu tinh MD5
                        MessageDigest md = MessageDigest.getInstance("MD5");
                        // doc toan bo du lieu trong chunk thanh mang byte
                        byte[] fileBytes = file.getBytes();
                        byte[] digest = md.digest(fileBytes);
                        // tao stringbuider de chuyen MD5 dang bytes thanh chuoi hexadecimal
                        StringBuilder hexString = new StringBuilder();
                        for (byte s : digest) {
                                hexString.append(String.format("%02x", s));
                        }
                        calculatedMD5 = hexString.toString();
                } catch (NoSuchAlgorithmException e) {
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "MD5_ERROR",
                                        "không thể tính MD5");
                } catch (Exception e) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "CHUNK_READ_ERROR",
                                        "Không thể đọc dữ liệu chunk");
                }
                logChunkStage(uploadSessionId, chunkIndex, "checksum", stageStartedAt);
                log.info("[chunk-upload] checksum-ok session={} chunkIndex={} objectKey={}",
                                uploadSessionId,
                                chunkIndex,
                                objectKey);
                // so sanh MD5 FE va BE
                if (!calculatedMD5.equalsIgnoreCase(checksumMD5.trim())) {
                        log.warn("[chunked-upload] checksum mismatch uploadSessionId={}, chunkIndex={}, expectedChecksum={}, calculatedChecksum={}, objectKey={}",
                                        uploadSessionId,
                                        chunkIndex,
                                        checksumMD5,
                                        calculatedMD5,
                                        objectKey);
                        uploadSessionRepository.updateStatusForUser(uploadSessionId, crusUser.getId(), UploadSessionStatus.FAILED);
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "CHECKSUM_MISMATCH",
                                        "Chunk checksum dữ liệu không khớp");
                }

                // upload chunk vao minio
                stageStartedAt = System.nanoTime();
                log.info("[chunk-upload] minio-put-start session={} chunkIndex={} objectKey={} sizeBytes={}",
                                uploadSessionId,
                                chunkIndex,
                                objectKey,
                                file.getSize());
                try {
                        timing.step = "minio-put";
                        minioService.upLoad(file, objectKey);
                        timing.minioStored = true;
                } catch (Exception e) {
                        log.error("[chunked-upload] MinIO putObject failed uploadSessionId={}, chunkIndex={}, objectKey={}, checksumMD5={}, sizeBytes={}",
                                        uploadSessionId,
                                        chunkIndex,
                                        objectKey,
                                        checksumMD5,
                                        file.getSize(),
                                        e);
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "ERR_MINIO_UNAVAILABLE",
                                        "Không thể lưu chunk vào MinIO");
                }
                timing.minioPutMs = elapsedMs(stageStartedAt);
                log.info("[chunk-upload] minio-put-end session={} chunkIndex={} objectKey={}",
                                uploadSessionId,
                                chunkIndex,
                                objectKey);
                logChunkStage(uploadSessionId, chunkIndex, "MinIO putObject", stageStartedAt);

                long uploadedChunkCount;
                Object transitionLock = UPLOAD_SESSION_LOCKS.computeIfAbsent(uploadSessionId, ignored -> new Object());
                synchronized (transitionLock) {
                        stageStartedAt = System.nanoTime();
                        UploadSession latestSession = uploadSessionRedisService.get(uploadSessionId);
                        timing.step = "redis-marker";
                        uploadSessionRedisService.markChunkUploaded(uploadSessionId, chunkIndex);
                        timing.accepted = true;
                        timing.step = "redis-session";
                        log.info("[chunk-upload] redis-sadd session={} chunkIndex={} objectKey={}",
                                        uploadSessionId,
                                        chunkIndex,
                                        objectKey);
                        uploadedChunkCount = uploadSessionRedisService.uploadedChunkCount(uploadSessionId);
                        timing.uploadedCount = uploadedChunkCount;
                        log.info("[chunk-upload] redis-count session={} chunkIndex={} uploadedCount={} totalChunks={}",
                                        uploadSessionId,
                                        chunkIndex,
                                        uploadedChunkCount,
                                        latestSession.getTotalChunks());
                        UploadSessionStatus oldStatus = latestSession.getStatus();
                        latestSession.setReceivedChunks((int) uploadedChunkCount);
                        if (checksumSha256 != null) {
                                latestSession.setChecksumSha256(checksumSha256);
                        }
                        boolean uploadActive = latestSession.getStatus() == UploadSessionStatus.INITIATED
                                        || latestSession.getStatus() == UploadSessionStatus.UPLOADING
                                        || latestSession.getStatus() == UploadSessionStatus.READY_TO_MERGE;
                        timing.finalizationAllowed = uploadActive;
                        if (uploadActive && uploadedChunkCount >= latestSession.getTotalChunks()) {
                                latestSession.setReceivedChunks(latestSession.getTotalChunks());
                                latestSession.setStatus(UploadSessionStatus.READY_TO_MERGE);
                        } else if (latestSession.getStatus() == UploadSessionStatus.INITIATED
                                        || latestSession.getStatus() == UploadSessionStatus.READY_TO_MERGE) {
                                latestSession.setStatus(UploadSessionStatus.UPLOADING);
                        }
                        logStatusTransition(
                                        "chunk",
                                        uploadSessionId,
                                        oldStatus,
                                        latestSession.getStatus(),
                                        latestSession.getReceivedChunks(),
                                        latestSession.getTotalChunks(),
                                        uploadedChunkCount);
                        uploadSessionRedisService.save(latestSession);
                        session = latestSession;
                }
                timing.redisMarkMs = elapsedMs(stageStartedAt);
                logChunkStage(uploadSessionId, chunkIndex, "Redis mark/save", stageStartedAt);

                stageStartedAt = System.nanoTime();
                timing.step = "db-progress";
                if (timing.finalizationAllowed && (session.getStatus() == UploadSessionStatus.READY_TO_MERGE
                                || session.getReceivedChunks() == 1
                                || session.getReceivedChunks() % 25 == 0)) {
                        uploadSessionRepository.updateProgressForUser(
                                        uploadSessionId,
                                        crusUser.getId(),
                                        session.getReceivedChunks(),
                                        session.getStatus());
                }
                timing.dbUpdateMs = elapsedMs(stageStartedAt);
                log.info("[chunk-upload] db-update session={} chunkIndex={} receivedChunks={} status={}",
                                uploadSessionId,
                                chunkIndex,
                                session.getReceivedChunks(),
                                session.getStatus());
                logChunkStage(uploadSessionId, chunkIndex, "PostgreSQL progress update", stageStartedAt);
                timing.step = "accepted";
                log.info("[chunk-upload] success session={} chunkIndex={} objectKey={} totalElapsedMs={}",
                                uploadSessionId,
                                chunkIndex,
                                objectKey,
                                elapsedMs(totalStartedAt));
                return ChunkUploadResponse.builder()
                                .uploadSessionId(sessionIdString)
                                .chunkIndex(chunkIndex)
                                .status("SUCCESS")
                                .message(objectKey)
                                .build();

        }

        private Integer chunkIndexOrNull(ChunkUploadRequest request) {
                return request == null ? null : request.getChunkIndex();
        }

        private static void safeChunkLog(Runnable logging) {
                try {
                        logging.run();
                } catch (RuntimeException | LinkageError ignored) {
                        // Diagnostic code must not invalidate an accepted chunk.
                }
        }

        private void scheduleAcceptedChunkWork(UUID sessionId, int totalChunks, int chunkIndex,
                        User user, ChunkRequestTiming timing) {
                long startedAt = System.nanoTime();
                try {
                        chunkMergeAsyncService.stageChunkGroupAsync(sessionId, totalChunks, chunkIndex);
                } catch (Exception e) {
                        safeChunkLog(() -> log.error("[chunk-upload] accepted; stage scheduling failed session={} chunkIndex={}",
                                        sessionId, chunkIndex, e));
                } finally {
                        timing.stageTriggerMs = elapsedMs(startedAt);
                }
                startedAt = System.nanoTime();
                try {
                        if (timing.finalizationAllowed && timing.uploadedCount >= totalChunks) {
                                scheduleAutoFinalization(sessionId, user, timing.startedAt);
                        }
                } catch (Exception e) {
                        safeChunkLog(() -> log.error("[chunk-upload] accepted; finalization scheduling failed session={} chunkIndex={}",
                                        sessionId, chunkIndex, e));
                } finally {
                        timing.mergeTriggerMs = elapsedMs(startedAt);
                }
        }

        private void scheduleAutoFinalization(UUID uploadSessionId, User user, long requestStartedAt) {
                if (!FINALIZATION_IN_FLIGHT.add(uploadSessionId)) {
                        log.debug("[chunked-finalization] already scheduled uploadSessionId={}", uploadSessionId);
                        return;
                }
                try {
                        chunkMergeAsyncService.executeAsync(() -> {
                                try {
                                        log.info("[chunked-finalization] scheduled uploadSessionId={}", uploadSessionId);
                                        startMergeIfReady(uploadSessionId, user, null, System.nanoTime(), "auto-background");
                                } catch (BusinessException e) {
                                        log.warn("[chunked-finalization] rejected uploadSessionId={}, code={}, message={}",
                                                        uploadSessionId, e.getCode(), e.getMessage());
                                        if ("MISSING_UPLOAD_CHUNKS".equals(e.getCode())) {
                                                markAutoFinalizationFailed(uploadSessionId, user.getId());
                                        }
                                } catch (Exception e) {
                                        log.error("[chunked-finalization] failed uploadSessionId={}", uploadSessionId, e);
                                        markAutoFinalizationFailed(uploadSessionId, user.getId());
                                } finally {
                                        FINALIZATION_IN_FLIGHT.remove(uploadSessionId);
                                }
                        });
                } catch (Exception e) {
                        FINALIZATION_IN_FLIGHT.remove(uploadSessionId);
                        log.error("[chunked-finalization] could not enqueue uploadSessionId={}, requestElapsedMs={}",
                                        uploadSessionId, elapsedMs(requestStartedAt), e);
                }
        }

        private void markAutoFinalizationFailed(UUID uploadSessionId, UUID userId) {
                markAutoFinalizationFailed(uploadSessionId, userId, false);
        }

        private void markAutoFinalizationFailed(UUID uploadSessionId, UUID userId, boolean dispatchFailed) {
                try {
                        UploadSession session = uploadSessionRedisService.get(uploadSessionId);
                        if ((session.getStatus() == UploadSessionStatus.MERGING && !dispatchFailed)
                                        || session.getStatus() == UploadSessionStatus.MERGE_FAILED
                                        || session.getStatus() == UploadSessionStatus.COMPLETED) return;
                        session.setStatus(UploadSessionStatus.MERGE_FAILED);
                        uploadSessionRedisService.save(session);
                        uploadSessionRepository.updateStatusForUser(
                                        uploadSessionId, userId, UploadSessionStatus.MERGE_FAILED);
                } catch (Exception statusError) {
                        log.error("[chunked-finalization] could not persist failure state uploadSessionId={}",
                                        uploadSessionId, statusError);
                }
        }

        private static final class ChunkRequestTiming {
                private final String sessionId;
                private final Integer chunkIndex;
                private final long startedAt = System.nanoTime();
                private int totalChunks;
                private boolean isLastIndex;
                private long minioPutMs;
                private long redisMarkMs;
                private long dbUpdateMs;
                private long missingCheckMs;
                private long stageTriggerMs;
                private long mergeTriggerMs;
                private boolean minioStored;
                private boolean accepted;
                private boolean finalizationAllowed = true;
                private long uploadedCount;
                private String step = "validation";
                private Runnable postAcceptance;

                private ChunkRequestTiming(ChunkUploadRequest request) {
                        sessionId = request == null ? null : request.getUploadSessionId();
                        chunkIndex = request == null ? null : request.getChunkIndex();
                }

                private void logSummary() {
                        long totalMs = elapsedMs(startedAt);
                        long otherMs = Math.max(0, totalMs - minioPutMs - redisMarkMs - dbUpdateMs
                                        - missingCheckMs - stageTriggerMs - mergeTriggerMs);
                        log.info("[chunk-upload] summary { uploadSessionId={}, chunkIndex={}, totalChunks={}, isLastIndex={}, minioPutMs={}, redisMarkMs={}, dbUpdateMs={}, missingCheckMs={}, stageTriggerMs={}, mergeTriggerMs={}, otherMs={}, totalMs={} }",
                                        sessionId, chunkIndex, totalChunks, isLastIndex, minioPutMs, redisMarkMs,
                                        dbUpdateMs, missingCheckMs, stageTriggerMs, mergeTriggerMs, otherMs, totalMs);
                }
        }

        @Override
        public void pauseUpload(String uploadSessionId) {
                UUID parsedUploadSessionId = parseUploadSessionId(uploadSessionId);
                try {
                        UploadSession session = uploadSessionRedisService.get(parsedUploadSessionId);
                        long uploadedChunkCount = getUploadedChunkCount(parsedUploadSessionId);
                        if (uploadedChunkCount >= session.getTotalChunks()
                                        && findMissingChunks(parsedUploadSessionId, session.getTotalChunks()).isEmpty()) {
                                syncSessionStatus(parsedUploadSessionId, session, UploadSessionStatus.READY_TO_MERGE, uploadedChunkCount);
                                return;
                        }
                        updatePersistentStatus(uploadSessionId, UploadSessionStatus.PAUSED);
                        UploadSessionStatus oldStatus = session.getStatus();
                        session.setStatus(UploadSessionStatus.PAUSED);
                        uploadSessionRedisService.save(session);
                        logStatusTransition(
                                        "pause",
                                        parsedUploadSessionId,
                                        oldStatus,
                                        session.getStatus(),
                                        session.getReceivedChunks(),
                                        session.getTotalChunks(),
                                        uploadedChunkCount);
                } catch (Exception ignored) {
                }
        }

        @Override
        public void resumeUpload(String uploadSessionId) {
                UUID parsedUploadSessionId = parseUploadSessionId(uploadSessionId);
                try {
                        UploadSession session = uploadSessionRedisService.get(parsedUploadSessionId);
                        long uploadedChunkCount = getUploadedChunkCount(parsedUploadSessionId);
                        if (uploadedChunkCount >= session.getTotalChunks()) {
                                syncSessionStatus(parsedUploadSessionId, session, UploadSessionStatus.READY_TO_MERGE, uploadedChunkCount);
                                return;
                        }
                        updatePersistentStatus(uploadSessionId, UploadSessionStatus.UPLOADING);
                        if (session.getStatus() == UploadSessionStatus.PAUSED) {
                                UploadSessionStatus oldStatus = session.getStatus();
                                session.setStatus(UploadSessionStatus.UPLOADING);
                                uploadSessionRedisService.save(session);
                                logStatusTransition(
                                                "resume",
                                                parsedUploadSessionId,
                                                oldStatus,
                                                session.getStatus(),
                                                session.getReceivedChunks(),
                                                session.getTotalChunks(),
                                                uploadedChunkCount);
                        }
                } catch (Exception ignored) {
                }
        }

        @Override
        public void cancelUpload(String uploadSessionId) {
                updatePersistentStatus(uploadSessionId, UploadSessionStatus.CANCELLED);
                try {
                        UploadSession session = uploadSessionRedisService.get(UUID.fromString(uploadSessionId));
                        session.setStatus(UploadSessionStatus.CANCELLED);
                        uploadSessionRedisService.save(session);
                } catch (Exception ignored) {
                }
        }

        private void ensureCompletedObjectInUserFolder(
                        UUID uploadSessionId,
                        User user,
                        String originalFileName,
                        String safeFileName,
                        String finalObjectKey) {
                if (minioService.objectExists(finalObjectKey)) {
                        return;
                }

                String legacyObjectKey = "meetings/" + user.getId() + "/" + uploadSessionId + "/" + originalFileName;
                if (!minioService.objectExists(legacyObjectKey)) {
                        legacyObjectKey = "meetings/" + user.getId() + "/" + uploadSessionId + "/" + safeFileName;
                }
                if (!minioService.objectExists(legacyObjectKey)) {
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "MERGED_OBJECT_NOT_FOUND",
                                        "Không tìm thấy file đã merge trên MinIO");
                }

                try {
                        log.info(
                                        "Moving legacy merged object to user folder. uploadSessionId={}, legacyObjectKey={}, finalObjectKey={}",
                                        uploadSessionId,
                                        legacyObjectKey,
                                        finalObjectKey);
                        minioService.composeObjects(finalObjectKey, List.of(legacyObjectKey));
                        if (minioService.objectExists(finalObjectKey)) {
                                minioService.delete(legacyObjectKey);
                        }
                } catch (Exception e) {
                        log.error(
                                        "Could not move legacy merged object to user folder. uploadSessionId={}, legacyObjectKey={}, finalObjectKey={}",
                                        uploadSessionId,
                                        legacyObjectKey,
                                        finalObjectKey,
                                        e);
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "ERR_MINIO_MOVE_MERGED_FILE",
                                        "Không thể chuyển file đã merge vào thư mục người dùng");
                }
        }

        private MediaFile findOrCreateMediaFile(
                        User user,
                        UploadSession session,
                        String safeFileName,
                        String objectKey) {
                Long fileSizeBytes = session.getFileSize();
                if (fileSizeBytes == null || fileSizeBytes <= 0) {
                        try {
                                fileSizeBytes = minioService.getObjectSize(objectKey);
                        } catch (Exception e) {
                                log.error("[chunked-merge] could not read final object size objectKey={}", objectKey, e);
                                throw new BusinessException(
                                                HttpStatus.INTERNAL_SERVER_ERROR,
                                                "ERR_MINIO_STAT_FINAL_OBJECT",
                                                "Không thể kiểm tra file đã merge trên MinIO");
                        }
                }
                Long finalFileSizeBytes = fileSizeBytes;
                return mediaFileRepository.findByObjectKey(objectKey)
                                .orElseGet(() -> mediaFileRepository.save(
                                                MediaFile.builder()
                                                                .workspace_id(user.getId())
                                                                .uploaded_by(user.getId())
                                                                .original_name(safeFileName)
                                                                .object_key(objectKey)
                                                                .mime_type(detectMimeType(safeFileName))
                                                                .file_size_bytes(finalFileSizeBytes)
                                                                .status(MediaFileStatus.UPLOADED)
                                                                .build()));
        }

        private Meeting findOrCreateMeeting(User user, MediaFile mediaFile, String safeFileName) {
                return meetingRepository.findByMediaFileId(mediaFile.getId())
                                .orElseGet(() -> meetingRepository.save(
                                                Meeting.builder()
                                                                .workspace_id(user.getId())
                                                                .media_file_id(mediaFile.getId())
                                                                .title(safeFileName)
                                                                .status(MeetingStatus.PENDING)
                                                                .build()));
        }

        @Override
        public MergeUploadReponse mergeUpload(MergeUploadRequest request) {
                long requestStartedAt = System.nanoTime();
                if (request == null) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_REQUEST",
                                        "merge request không được để null");
                }

                String sessionIdString = request.getUploadSessionId();
                if (sessionIdString == null || sessionIdString.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_REQUEST",
                                        "upload session id không được để null");
                }

                UUID uploadSessionId;
                try {
                        uploadSessionId = UUID.fromString(sessionIdString);
                } catch (IllegalArgumentException e) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_UPLOAD_SESSION_ID",
                                        "upload session id không hợp lệ");
                }
                log.info("[chunked-merge] request start uploadSessionId={}", uploadSessionId);

                try {
                        User currUser = getCurrentUser();
                        return startMergeIfReady(uploadSessionId, currUser, request, requestStartedAt, "manual");
                } catch (BusinessException e) {
                        throw e;
                } catch (Exception e) {
                        log.error("[chunked-merge] request failed before async dispatch uploadSessionId={}, elapsedMs={}",
                                        uploadSessionId,
                                        elapsedMs(requestStartedAt),
                                        e);
                        throw e;
                }
        }

        private MergeUploadReponse startMergeIfReady(
                        UUID uploadSessionId,
                        User currUser,
                        MergeUploadRequest request,
                        long requestStartedAt,
                        String trigger) {
                Object transitionLock = UPLOAD_SESSION_LOCKS.computeIfAbsent(uploadSessionId, ignored -> new Object());
                synchronized (transitionLock) {
                        long stageStartedAt = System.nanoTime();
                        com.example.smartrec.entity.UploadSession persistentSession =
                                        uploadSessionRepository.findByIdAndUserId(uploadSessionId, currUser.getId())
                                                        .orElseThrow(() -> new BusinessException(
                                                                        HttpStatus.NOT_FOUND,
                                                                        "UPLOAD_SESSION_NOT_FOUND",
                                                                        "Không tìm thấy upload session trong PostgreSQL"));
                        UploadSession session = loadRedisSessionForMerge(uploadSessionId, persistentSession, request, currUser);
                        logMergeStage(uploadSessionId, "load session", stageStartedAt);

                        if (!session.getUserId().equals(currUser.getId())) {
                                throw new BusinessException(
                                                HttpStatus.FORBIDDEN,
                                                "UPLOAD_SESSION_NOT_OWNED",
                                                "Upload session không thuộc người dùng hiện tại");
                        }

                        String fileName = request != null ? request.getFileName() : null;
                        if (fileName == null || fileName.isBlank()) {
                                fileName = session.getFileName();
                        }
                        if (fileName == null || fileName.isBlank()) {
                                throw new BusinessException(
                                                HttpStatus.BAD_REQUEST,
                                                "INVALID_FILENAME",
                                                "Tên file không được để trống");
                        }
                        fileName = fileName.trim();
                        String safeFileName = sanitizeFileName(fileName);
                        String finalObjectKey = buildUserObjectKey(currUser, safeFileName);
                        String sourceObjectPrefix = "tmp/" + uploadSessionId + "/chunk_";
                        String sessionIdString = uploadSessionId.toString();

                        if (persistentSession.getStatus() == UploadSessionStatus.COMPLETED
                                        || session.getStatus() == UploadSessionStatus.COMPLETED) {
                                ensureCompletedObjectInUserFolder(uploadSessionId, currUser, fileName, safeFileName, finalObjectKey);
                                MediaFile mediaFile = findOrCreateMediaFile(currUser, session, safeFileName, finalObjectKey);
                                findOrCreateMeeting(currUser, mediaFile, safeFileName);
                                return new MergeUploadReponse(
                                                sessionIdString,
                                                safeFileName,
                                                finalObjectKey,
                                                UploadSessionStatus.COMPLETED.name());
                        }
                        if (persistentSession.getStatus() == UploadSessionStatus.MERGING
                                        || session.getStatus() == UploadSessionStatus.MERGING) {
                                return new MergeUploadReponse(
                                                sessionIdString,
                                                safeFileName,
                                                finalObjectKey,
                                                UploadSessionStatus.MERGING.name());
                        }
                        if (persistentSession.getStatus() == UploadSessionStatus.CANCELLED
                                        || session.getStatus() == UploadSessionStatus.CANCELLED
                                        || persistentSession.getStatus() == UploadSessionStatus.FAILED
                                        || session.getStatus() == UploadSessionStatus.FAILED) {
                                throw new BusinessException(
                                                HttpStatus.CONFLICT,
                                                "INVALID_UPLOAD_SESSION_STATUS",
                                                "Upload session không ở trạng thái cho phép merge");
                        }
                        Integer totalChunk = session.getTotalChunks();
                        if (totalChunk == null || totalChunk <= 0) {
                                throw new BusinessException(
                                                HttpStatus.BAD_REQUEST,
                                                "INVALID_TOTAL_CHUNKS",
                                                "total chunk không hợp lệ ");
                        }

                        stageStartedAt = System.nanoTime();
                        long uploadedChunkCount = getUploadedChunkCount(uploadSessionId);
                        logMergeStage(uploadSessionId, "validate uploaded chunk count", stageStartedAt);
                        boolean redisHasAllChunks = uploadedChunkCount == totalChunk;
                        // Exact logical coverage is in Redis. Stage size checks and
                        // MinIO compose validate physical sources in the merge worker.
                        List<Integer> missingChunkIndexes = uploadSessionRedisService.missingChunkIndexes(uploadSessionId, totalChunk);
                        redisHasAllChunks = redisHasAllChunks && missingChunkIndexes.isEmpty();
                        if (redisHasAllChunks) {
                                normalizeReadyToMergeIfComplete(
                                                uploadSessionId,
                                                session,
                                                persistentSession,
                                                totalChunk,
                                                uploadedChunkCount);
                        }
                        if (session.getStatus() != UploadSessionStatus.READY_TO_MERGE
                                        && session.getStatus() != UploadSessionStatus.MERGE_FAILED) {
                                logMergeSnapshot(
                                                uploadSessionId,
                                                session,
                                                persistentSession,
                                                uploadedChunkCount,
                                                sourceObjectPrefix,
                                                finalObjectKey,
                                                "invalid status before merge");
                                throw new BusinessException(
                                                HttpStatus.CONFLICT,
                                                "INVALID_UPLOAD_SESSION_STATUS",
                                                "Upload session không ở trạng thái cho phép merge");
                        }
                        if (!redisHasAllChunks) {
                                logMergeSnapshot(
                                                uploadSessionId,
                                                session,
                                                persistentSession,
                                                uploadedChunkCount,
                                                sourceObjectPrefix,
                                                finalObjectKey,
                                                "incomplete uploaded chunks");
                                throw new BusinessException(
                                                HttpStatus.CONFLICT,
                                                "MISSING_UPLOAD_CHUNKS",
                                                missingChunkIndexes.isEmpty()
                                                                ? "Upload chưa đủ chunk để merge"
                                                                : "Thiếu " + missingChunkIndexes.size() + " chunk trước khi merge",
                                                missingChunkDetails(missingChunkIndexes));
                        }

                        session.setStatus(UploadSessionStatus.MERGING);
                        persistentSession.setStatus(UploadSessionStatus.MERGING);
                        persistentSession.setReceivedChunks(totalChunk);
                        uploadSessionRedisService.save(session);
                        uploadSessionRepository.save(persistentSession);

                        logMergeSnapshot(
                                        uploadSessionId,
                                        session,
                                        persistentSession,
                                        uploadedChunkCount,
                                        sourceObjectPrefix,
                                        finalObjectKey,
                                        "dispatch async merge " + trigger);

                        try {
                                chunkMergeAsyncService.mergeAsync(new MergeJob(
                                        uploadSessionId,
                                        currUser.getId(),
                                        session,
                                        safeFileName,
                                        sourceObjectPrefix,
                                        finalObjectKey,
                                        totalChunk,
                                        session.getReceivedChunks(),
                                        uploadedChunkCount,
                                        session.getQuickFingerprint(),
                                        session.getChecksumSha256(), requestStartedAt));
                        } catch (RuntimeException dispatchError) {
                                // MERGING was persisted before dispatch. A rejected
                                // task must expose retry instead of polling forever.
                                markAutoFinalizationFailed(uploadSessionId, currUser.getId(), true);
                                throw dispatchError;
                        }

                        log.info("[chunked-merge] request accepted trigger={}, uploadSessionId={}, finalObjectKey={}, totalChunks={}, elapsedMs={}",
                                        trigger,
                                        uploadSessionId,
                                        finalObjectKey,
                                        totalChunk,
                                        elapsedMs(requestStartedAt));
                        return new MergeUploadReponse(sessionIdString, safeFileName, finalObjectKey,
                                        UploadSessionStatus.MERGING.name());
                }
        }

        private UploadSession loadRedisSessionForMerge(
                        UUID uploadSessionId,
                        com.example.smartrec.entity.UploadSession persistentSession,
                        MergeUploadRequest request,
                        User currUser) {
                try {
                        return uploadSessionRedisService.get(uploadSessionId);
                } catch (Exception e) {
                        boolean postgresHasAllChunks = persistentSession.getReceivedChunks() != null
                                        && persistentSession.getTotalChunks() != null
                                        && persistentSession.getReceivedChunks().equals(persistentSession.getTotalChunks());
                        if (!postgresHasAllChunks) {
                                throw e;
                        }
                        String fileName = request != null ? request.getFileName() : null;
                        if (fileName == null || fileName.isBlank()) {
                                log.error(
                                                "[chunked-merge] Redis session missing and request has no fileName uploadSessionId={}, persistentStatus={}, totalChunks={}, receivedChunks={}",
                                                uploadSessionId,
                                                persistentSession.getStatus(),
                                                persistentSession.getTotalChunks(),
                                                persistentSession.getReceivedChunks(),
                                                e);
                                throw new BusinessException(
                                                HttpStatus.CONFLICT,
                                                "UPLOAD_SESSION_REDIS_EXPIRED",
                                                "Upload session trong Redis đã hết hạn. Không đủ thông tin fileName để retry merge.");
                        }
                        log.warn(
                                        "[chunked-merge] Redis session missing; rebuilding merge snapshot from PostgreSQL uploadSessionId={}, persistentStatus={}, totalChunks={}, receivedChunks={}",
                                        uploadSessionId,
                                        persistentSession.getStatus(),
                                        persistentSession.getTotalChunks(),
                                        persistentSession.getReceivedChunks(),
                                        e);
                        return UploadSession.builder()
                                        .uploadSessionId(uploadSessionId)
                                        .userId(currUser.getId())
                                        .fileName(fileName.trim())
                                        .fileSize(null)
                                        .totalChunks(persistentSession.getTotalChunks())
                                        .chunkSize(CHUNK_SIZE)
                                        .receivedChunks(persistentSession.getReceivedChunks())
                                        .status(persistentSession.getStatus())
                                        .quickFingerprint(null)
                                        .build();
                }
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

        private long getUploadedChunkCount(UUID uploadSessionId) {
                try {
                        return uploadSessionRedisService.uploadedChunkCount(uploadSessionId);
                } catch (Exception e) {
                        log.warn("[chunked-merge] could not read Redis uploaded chunk count uploadSessionId={}",
                                        uploadSessionId,
                                        e);
                        return -1;
                }
        }

        private List<Integer> findMissingChunks(UUID uploadSessionId, int totalChunks) {
                Set<Integer> missing = new java.util.TreeSet<>(
                                uploadSessionRedisService.missingChunkIndexes(uploadSessionId, totalChunks));
                for (int index = 0; index < totalChunks; index++) {
                        String objectKey = "tmp/" + uploadSessionId + "/chunk_" + index;
                        if (!minioService.objectExists(objectKey)) {
                                missing.add(index);
                        }
                }
                return List.copyOf(missing);
        }

        private List<String> missingChunkDetails(List<Integer> missingChunkIndexes) {
                return missingChunkIndexes.stream()
                                .map(String::valueOf)
                                .toList();
        }

        private void normalizeReadyToMergeIfComplete(
                        UUID uploadSessionId,
                        UploadSession session,
                        com.example.smartrec.entity.UploadSession persistentSession,
                        Integer totalChunks,
                        long redisUploadedChunkCount) {
                if (session.getStatus() == UploadSessionStatus.COMPLETED
                                || session.getStatus() == UploadSessionStatus.MERGING
                                || session.getStatus() == UploadSessionStatus.MERGE_FAILED) {
                        return;
                }
                if (session.getStatus() == UploadSessionStatus.READY_TO_MERGE
                                && persistentSession.getStatus() == UploadSessionStatus.READY_TO_MERGE
                                && session.getReceivedChunks() != null
                                && session.getReceivedChunks().equals(totalChunks)
                                && persistentSession.getReceivedChunks() != null
                                && persistentSession.getReceivedChunks().equals(totalChunks)) {
                        return;
                }
                UploadSessionStatus oldRedisStatus = session.getStatus();
                UploadSessionStatus oldPersistentStatus = persistentSession.getStatus();
                session.setReceivedChunks(totalChunks);
                session.setStatus(UploadSessionStatus.READY_TO_MERGE);
                persistentSession.setReceivedChunks(totalChunks);
                persistentSession.setStatus(UploadSessionStatus.READY_TO_MERGE);
                uploadSessionRedisService.save(session);
                uploadSessionRepository.save(persistentSession);
                logStatusTransition(
                                "normalize-ready-to-merge-redis",
                                uploadSessionId,
                                oldRedisStatus,
                                session.getStatus(),
                                session.getReceivedChunks(),
                                totalChunks,
                                redisUploadedChunkCount);
                logStatusTransition(
                                "normalize-ready-to-merge-postgres",
                                uploadSessionId,
                                oldPersistentStatus,
                                persistentSession.getStatus(),
                                persistentSession.getReceivedChunks(),
                                persistentSession.getTotalChunks(),
                                redisUploadedChunkCount);
        }

        private void logStatusTransition(
                        String source,
                        UUID uploadSessionId,
                        UploadSessionStatus oldStatus,
                        UploadSessionStatus newStatus,
                        Integer receivedChunks,
                        Integer totalChunks,
                        long redisUploadedCount) {
                log.info(
                                "[chunked-upload] status transition source={}, uploadSessionId={}, oldStatus={}, newStatus={}, receivedChunks={}, totalChunks={}, redisUploadedCount={}",
                                source,
                                uploadSessionId,
                                oldStatus,
                                newStatus,
                                receivedChunks,
                                totalChunks,
                                redisUploadedCount);
        }

        private void logMergeSnapshot(
                        UUID uploadSessionId,
                        UploadSession session,
                        com.example.smartrec.entity.UploadSession persistentSession,
                        long redisUploadedChunkCount,
                        String sourceObjectPrefix,
                        String finalObjectKey,
                        String reason) {
                log.info(
                                "[chunked-merge] snapshot reason={}, uploadSessionId={}, currentStatus={}, persistentStatus={}, totalChunks={}, receivedChunks={}, persistentReceivedChunks={}, redisUploadedChunkCount={}, sourceObjectPrefix={}, finalObjectKey={}",
                                reason,
                                uploadSessionId,
                                session.getStatus(),
                                persistentSession.getStatus(),
                                session.getTotalChunks(),
                                session.getReceivedChunks(),
                                persistentSession.getReceivedChunks(),
                                redisUploadedChunkCount,
                                sourceObjectPrefix,
                                finalObjectKey);
        }

        @Override
        public UploadSessionStatusResponse getUploadSessionStatus(String sessionIdString) {
                long statusStartedAt = System.nanoTime();
                UUID uploadSessionId = parseUploadSessionId(sessionIdString);
                User user = getCurrentUser();
                long databaseStartedAt = System.nanoTime();
                com.example.smartrec.entity.UploadSession persistentSession =
                                uploadSessionRepository.findByIdAndUserId(uploadSessionId, user.getId())
                                                .orElseThrow(() -> new BusinessException(
                                                                HttpStatus.NOT_FOUND,
                                                                "UPLOAD_SESSION_NOT_FOUND",
                                                                "Không tìm thấy upload session trong PostgreSQL"));
                long databaseLookupMs = elapsedMs(databaseStartedAt);
                UploadSession session = null;
                long redisStartedAt = System.nanoTime();
                try {
                        session = uploadSessionRedisService.get(uploadSessionId);
                } catch (Exception ignored) {
                }
                long redisSessionMs = elapsedMs(redisStartedAt);
                Integer receivedChunks = session != null
                                ? session.getReceivedChunks()
                                : persistentSession.getReceivedChunks();
                Integer totalChunks = session != null
                                ? session.getTotalChunks()
                                : persistentSession.getTotalChunks();
                long missingStartedAt = System.nanoTime();
                long redisUploadedCount = getUploadedChunkCount(uploadSessionId);
                // Status is polled repeatedly while chunks upload/merge. Redis is
                // authoritative here because chunk markers are written only after
                // successful MinIO PUT. Full MinIO HEAD verification stays in the
                // one-shot merge preflight, never in each status poll.
                List<Integer> missingChunks = totalChunks == null
                                ? List.of()
                                : uploadSessionRedisService.missingChunkIndexes(uploadSessionId, totalChunks);
                if (totalChunks != null) receivedChunks = totalChunks - missingChunks.size();
                long redisChunksMs = elapsedMs(missingStartedAt);
                boolean redisHasAllChunks = totalChunks != null
                                && redisUploadedCount == totalChunks
                                && missingChunks.isEmpty();
                if (redisHasAllChunks
                                && session != null
                                && session.getStatus() != UploadSessionStatus.MERGING
                                && session.getStatus() != UploadSessionStatus.COMPLETED
                                && session.getStatus() != UploadSessionStatus.MERGE_FAILED) {
                        scheduleAutoFinalization(uploadSessionId, user, statusStartedAt);
                }
                if (session != null
                                && redisHasAllChunks
                                && session.getStatus() != UploadSessionStatus.MERGING
                                && session.getStatus() != UploadSessionStatus.COMPLETED
                                && session.getStatus() != UploadSessionStatus.MERGE_FAILED) {
                        normalizeReadyToMergeIfComplete(
                                        uploadSessionId,
                                        session,
                                        persistentSession,
                                        totalChunks,
                                        redisUploadedCount);
                        receivedChunks = session.getReceivedChunks();
                }
                if (!missingChunks.isEmpty()
                                && persistentSession.getStatus() == UploadSessionStatus.READY_TO_MERGE) {
                        UploadSessionStatus oldPersistentStatus = persistentSession.getStatus();
                        int reconciledReceivedChunks = totalChunks != null
                                        ? totalChunks - missingChunks.size()
                                        : 0;
                        persistentSession.setStatus(UploadSessionStatus.UPLOADING);
                        persistentSession.setReceivedChunks(reconciledReceivedChunks);
                        uploadSessionRepository.save(persistentSession);
                        if (session != null) {
                                UploadSessionStatus oldRedisStatus = session.getStatus();
                                session.setStatus(UploadSessionStatus.UPLOADING);
                                session.setReceivedChunks(reconciledReceivedChunks);
                                uploadSessionRedisService.save(session);
                                logStatusTransition(
                                                "status-redis-missing-reconcile",
                                                uploadSessionId,
                                                oldRedisStatus,
                                                session.getStatus(),
                                                session.getReceivedChunks(),
                                                session.getTotalChunks(),
                                                redisUploadedCount);
                        }
                        receivedChunks = reconciledReceivedChunks;
                        logStatusTransition(
                                        "status-postgres-missing-reconcile",
                                        uploadSessionId,
                                        oldPersistentStatus,
                                        persistentSession.getStatus(),
                                        persistentSession.getReceivedChunks(),
                                        persistentSession.getTotalChunks(),
                                        redisUploadedCount);
                }
                if (session == null
                                && redisHasAllChunks
                                && persistentSession.getStatus() != UploadSessionStatus.MERGING
                                && persistentSession.getStatus() != UploadSessionStatus.COMPLETED
                                && persistentSession.getStatus() != UploadSessionStatus.MERGE_FAILED) {
                        UploadSessionStatus oldPersistentStatus = persistentSession.getStatus();
                        persistentSession.setStatus(UploadSessionStatus.READY_TO_MERGE);
                        persistentSession.setReceivedChunks(totalChunks);
                        uploadSessionRepository.save(persistentSession);
                        logStatusTransition(
                                        "status-postgres-normalize",
                                        uploadSessionId,
                                        oldPersistentStatus,
                                        persistentSession.getStatus(),
                                        persistentSession.getReceivedChunks(),
                                        persistentSession.getTotalChunks(),
                                        redisUploadedCount);
                }
                log.info("[chunked-status] summary uploadSessionId={}, status={}, totalChunks={}, redisUploadedCount={}, databaseLookupMs={}, redisSessionMs={}, redisChunksMs={}, totalMs={}, missingChunks={}",
                                uploadSessionId,
                                persistentSession.getStatus(),
                                totalChunks,
                                redisUploadedCount,
                                databaseLookupMs,
                                redisSessionMs,
                                redisChunksMs,
                                elapsedMs(statusStartedAt), missingChunks);
                return new UploadSessionStatusResponse(
                                sessionIdString,
                                persistentSession.getStatus().name(),
                                receivedChunks,
                                totalChunks,
                                missingChunks);
        }

        private void logMergeStage(UUID uploadSessionId, String stage, long startedAtNanos) {
                log.info("[chunked-merge] {} uploadSessionId={}, elapsedMs={}",
                                stage,
                                uploadSessionId,
                                elapsedMs(startedAtNanos));
        }

        private void logChunkStage(UUID uploadSessionId, Integer chunkIndex, String stage, long startedAtNanos) {
                log.info("[chunked-upload] {} uploadSessionId={}, chunkIndex={}, elapsedMs={}",
                                stage,
                                uploadSessionId,
                                chunkIndex,
                                elapsedMs(startedAtNanos));
        }

        private static long elapsedMs(long startedAtNanos) {
                return (System.nanoTime() - startedAtNanos) / 1_000_000;
        }
        

}
