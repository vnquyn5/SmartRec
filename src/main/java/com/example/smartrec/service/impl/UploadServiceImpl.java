package com.example.smartrec.service.impl;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.enums.UploadSessionStatus;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.UploadSession;
import com.example.smartrec.model.dto.ChunkUploadRequest;
import com.example.smartrec.model.dto.ChunkUploadResponse;
import com.example.smartrec.model.dto.MergeUploadReponse;
import com.example.smartrec.model.dto.MergeUploadRequest;
import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.repository.UploadSessionRepository;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.UploadService;
import com.example.smartrec.service.UploadSessionRedisService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class UploadServiceImpl implements UploadService {
        private static final Logger log = LoggerFactory.getLogger(UploadServiceImpl.class);

        private final UserRepository userRepository;
        private final UploadSessionRepository uploadSessionRepository;
        private final MediaFileRepository mediaFileRepository;
        private final MeetingRepository meetingRepository;
        private final UploadSessionRedisService uploadSessionRedisService;
        private final MinioService minioService;
        private final DataSource dataSource;

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
                String fileName = request.getFileName();
                if (fileName == null || fileName.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "ERR_INVALID_FILENAME",
                                        "Tên file không được để trống");
                }
                fileName = fileName.trim();

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
                                .fileName(fileName)
                                .fileSize(fileSize)
                                .totalChunks(totalChunks)
                                .chunkSize(CHUNK_SIZE)
                                .receivedChunks(0)
                                .status(UploadSessionStatus.INITIATED)
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

        @Override
        public ChunkUploadResponse uploadChunk(ChunkUploadRequest request) {
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
                com.example.smartrec.entity.UploadSession persistentSession =
                                uploadSessionRepository.findById(uploadSessionId)
                                                .orElseThrow(() -> new BusinessException(
                                                                HttpStatus.NOT_FOUND,
                                                                "UPLOAD_SESSION_NOT_FOUND",
                                                                "Không tìm thấy upload session trong PostgreSQL"));

                if (!session.getUserId().equals(crusUser.getId())) {
                        throw new BusinessException(
                                        HttpStatus.FORBIDDEN,
                                        "UPLOAD_SESSION_NOT_OWNED",
                                        "Upload session không thuộc người dùng hiện tại");
                }

                if (session.getStatus() != UploadSessionStatus.INITIATED
                                && session.getStatus() != UploadSessionStatus.UPLOADING) {
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "INVALID_UPLOAD_SESSION_STATUS",
                                        "Upload session không ở trạng thái cho phép upload chunk");
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

                // kiem tra chunk da upload chua
                if (uploadSessionRedisService.isChunkUploaded(uploadSessionId, chunkIndex)) {
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "CHUNK_ALREADY_EXISTS",
                                        "Chunk đã được upload");
                }

                // lay chunksum tu fe gui
                String checksumMD5 = request.getChecksumMD5();
                if (checksumMD5 == null || checksumMD5.isBlank()) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_CHUNKSUM",
                                        "Checksum MD5 không được để trống");
                }

                String calculatedMD5;
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
                // so sanh MD5 FE va BE
                if (!calculatedMD5.equalsIgnoreCase(checksumMD5.trim())) {
                        persistentSession.setStatus(UploadSessionStatus.FAILED);
                        uploadSessionRepository.save(persistentSession);
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "CHECKSUM_MISMATCH",
                                        "Chunk checksum dữ liệu không khớp");
                }

                // tao obj cho chunk
                String objectKey = "tmp/"
                                + uploadSessionId
                                + "/chunk_"
                                + chunkIndex;

                // upload chunk vao minio
                try {
                        minioService.upLoad(file, objectKey);
                } catch (Exception e) {
                        persistentSession.setStatus(UploadSessionStatus.FAILED);
                        uploadSessionRepository.save(persistentSession);
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "ERR_MINIO_UNAVAILABLE",
                                        "Không thể lưu chunk vào MinIO");
                }

                // danh giau chunk da upload trong redis
                uploadSessionRedisService.markChunkUploaded(uploadSessionId, chunkIndex);
                // tang so luong chunk da nhan
                int receivedChunks = session.getReceivedChunks();
                session.setReceivedChunks(receivedChunks + 1);

                // Đổi INITIATED → UPLOADING
                if (session.getStatus() == UploadSessionStatus.INITIATED) {
                        session.setStatus(UploadSessionStatus.UPLOADING);
                }
                if (session.getReceivedChunks() >= session.getTotalChunks()) {
                        session.setStatus(UploadSessionStatus.READY_TO_MERGE);
                }
                persistentSession.setReceivedChunks(session.getReceivedChunks());
                persistentSession.setStatus(session.getStatus());
                uploadSessionRepository.save(persistentSession);

                // luu session mo vao redis
                uploadSessionRedisService.save(session);
                return ChunkUploadResponse.builder()
                                .uploadSessionId(sessionIdString)
                                .chunkIndex(chunkIndex)
                                .status("SUCCESS")
                                .message(objectKey)
                                .build();

        }

        @Override
        public void pauseUpload(String uploadSessionId) {
                updatePersistentStatus(uploadSessionId, UploadSessionStatus.PAUSED);
                try {
                        UploadSession session = uploadSessionRedisService.get(UUID.fromString(uploadSessionId));
                        session.setStatus(UploadSessionStatus.PAUSED);
                        uploadSessionRedisService.save(session);
                } catch (Exception ignored) {
                }
        }

        @Override
        public void resumeUpload(String uploadSessionId) {
                updatePersistentStatus(uploadSessionId, UploadSessionStatus.UPLOADING);
                try {
                        UploadSession session = uploadSessionRedisService.get(UUID.fromString(uploadSessionId));
                        if (session.getStatus() == UploadSessionStatus.PAUSED) {
                                session.setStatus(UploadSessionStatus.UPLOADING);
                                uploadSessionRedisService.save(session);
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
                return mediaFileRepository.findByObjectKey(objectKey)
                                .orElseGet(() -> mediaFileRepository.save(
                                                MediaFile.builder()
                                                                .workspace_id(user.getId())
                                                                .uploaded_by(user.getId())
                                                                .original_name(safeFileName)
                                                                .object_key(objectKey)
                                                                .mime_type(detectMimeType(safeFileName))
                                                                .file_size_bytes(session.getFileSize())
                                                                .status("UPLOADED")
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
                // xac thu yeu cau
                if (request == null) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_REQUEST",
                                        "merge request không được để null");
                }

                // xac thu ma UploadSessionId
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

                // lay user hien tai
                User currUser = getCurrentUser();

                // lay session tu redis
                UploadSession session = uploadSessionRedisService.get(uploadSessionId);
                com.example.smartrec.entity.UploadSession persistentSession =
                                uploadSessionRepository.findById(uploadSessionId)
                                                .orElseThrow(() -> new BusinessException(
                                                                HttpStatus.NOT_FOUND,
                                                                "UPLOAD_SESSION_NOT_FOUND",
                                                                "Không tìm thấy upload session trong PostgreSQL"));
                // session khong ton tai
                if (session == null) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "UPLOAD_SESSION_NOT_FOUND",
                                        "không tìm thấy upload session ");
                }
                // kiem tra quyen so huu khong
                if (!session.getUserId().equals(currUser.getId())) {
                        throw new BusinessException(
                                        HttpStatus.FORBIDDEN,
                                        "UPLOAD_SESSION_NOT_OWNED",
                                        "Upload session không thuộc người dùng hiện tại");
                }

                String fileName = request.getFileName();
                if (fileName == null || fileName.isBlank()) {
                        fileName = session.getFileName();// lay ten file trong upload session
                }
                if (fileName == null || fileName.isBlank()) { // neu ca reuest voi session dau khong co ten file
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_FILENAME",
                                        "Tên file không được để trống");
                }
                fileName = fileName.trim();
                String safeFileName = sanitizeFileName(fileName);
                String finalObjectKey = buildUserObjectKey(currUser, safeFileName);

                if (persistentSession.getStatus() == UploadSessionStatus.COMPLETED) {
                        ensureCompletedObjectInUserFolder(uploadSessionId, currUser, fileName, safeFileName, finalObjectKey);
                        MediaFile mediaFile = findOrCreateMediaFile(currUser, session, safeFileName, finalObjectKey);
                        findOrCreateMeeting(currUser, mediaFile, safeFileName);
                        return new MergeUploadReponse(
                                        sessionIdString,
                                        safeFileName,
                                        finalObjectKey,
                                        UploadSessionStatus.COMPLETED.name());
                }
                // kiem tra trạng thai session
                if (session.getStatus() != UploadSessionStatus.INITIATED
                                && session.getStatus() != UploadSessionStatus.UPLOADING
                                && session.getStatus() != UploadSessionStatus.READY_TO_MERGE) {
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "INVALID_UPLOAD_SESSION_STATUS",
                                        "Upload session không ở trạng thái cho phép merge");
                }
                // lay tong chunk
                Integer totalChunk = session.getTotalChunks();
                if (totalChunk == null || totalChunk <= 0) {
                        throw new BusinessException(
                                        HttpStatus.BAD_REQUEST,
                                        "INVALID_TOTAL_CHUNKS",
                                        "total chunk không hợp lệ ");
                }

                // tim chunk bi thieu

                // danh sach dung de luu index cua nhung chunk chua upload
                List<Integer> missingChunk = new ArrayList<>();
                for (int i = 0; i < totalChunk; i++) {
                        boolean uploaded = uploadSessionRedisService.isChunkUploaded(uploadSessionId, i);
                        if (!uploaded) {
                                missingChunk.add(i);
                        }
                }

                // neu chunk bi thieu se khong merge
                if (!missingChunk.isEmpty()) {
                        persistentSession.setStatus(UploadSessionStatus.FAILED);
                        uploadSessionRepository.save(persistentSession);
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "UPLOAD_INCOMPLETE",
                                        "1 so phan bi thieu :" + missingChunk);
                }
                // tao danh sach object key cua chunk
                List<String> chunkObjectKeys = new ArrayList<>();
                for (int i = 0; i < totalChunk; i++) {
                        String chunkObjectKey = "tmp/"
                                        + uploadSessionId
                                        + "/chunk_"
                                        + i;

                        chunkObjectKeys.add(chunkObjectKey);
                }

                List<Integer> missingMinioChunks = new ArrayList<>();
                for (int i = 0; i < chunkObjectKeys.size(); i++) {
                        String chunkObjectKey = chunkObjectKeys.get(i);
                        if (!minioService.objectExists(chunkObjectKey)) {
                                log.error(
                                                "Missing chunk object before merge. uploadSessionId={}, chunkIndex={}, bucketObjectKey={}",
                                                uploadSessionId,
                                                i,
                                                chunkObjectKey);
                                missingMinioChunks.add(i);
                        }
                }
                if (!missingMinioChunks.isEmpty()) {
                        persistentSession.setStatus(UploadSessionStatus.FAILED);
                        uploadSessionRepository.save(persistentSession);
                        throw new BusinessException(
                                        HttpStatus.CONFLICT,
                                        "MINIO_CHUNKS_MISSING",
                                        "Thiếu chunk trong MinIO: " + missingMinioChunks);
                }

                // ghep cac chunk trong miniio
                try {
                        log.info(
                                        "Merging upload session. uploadSessionId={}, bucket chunk prefix=tmp/{}/chunk_, finalObjectKey={}, totalChunks={}",
                                        uploadSessionId,
                                        uploadSessionId,
                                        finalObjectKey,
                                        totalChunk);
                        minioService.composeObjects(finalObjectKey, chunkObjectKeys);// gui ds chunk trog mini de ghep
                                                                                     // thanh file hoan chinh
                } catch (Exception e) {
                        persistentSession.setStatus(UploadSessionStatus.MERGE_FAILED);
                        uploadSessionRepository.save(persistentSession);
                        log.error(
                                        "Failed to compose upload session in MinIO. uploadSessionId={}, finalObjectKey={}, totalChunks={}",
                                        uploadSessionId,
                                        finalObjectKey,
                                        totalChunk,
                                        e);
                        throw new BusinessException(
                                        HttpStatus.INTERNAL_SERVER_ERROR,
                                        "ERR_MINIO_COMPOSE",
                                        "Không thể merge các chunk trong MinIO");
                }

                // danh giau session da hoan thanh
                session.setStatus(UploadSessionStatus.COMPLETED);
                session.setReceivedChunks(totalChunk);
                persistentSession.setReceivedChunks(totalChunk);
                persistentSession.setStatus(UploadSessionStatus.COMPLETED);

                uploadSessionRedisService.save(session);
                uploadSessionRepository.save(persistentSession);
                MediaFile mediaFile = findOrCreateMediaFile(currUser, session, safeFileName, finalObjectKey);
                findOrCreateMeeting(currUser, mediaFile, safeFileName);

                // xoa chunk tam sau khi final object da ton tai
                for(String chunkObjectKey : chunkObjectKeys){// duyet qua tung chunk da dung de compose
                        try {
                                minioService.delete(chunkObjectKey);// xoa chunk tam thoi khoi mini
                        } catch (Exception e) {
                        }
                }
                return new MergeUploadReponse(sessionIdString,safeFileName,finalObjectKey,UploadSessionStatus.COMPLETED.name());
        }
}
