package com.example.smartrec.service.impl;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.entity.MediaFile;
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
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.DurationValidationService;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.UploadService;
import com.example.smartrec.service.UploadSessionRedisService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class UploadServiceImpl implements UploadService {

    private final UserRepository userRepository;
    private final UploadSessionRedisService uploadSessionRedisService;
    private final MinioService minioService;
    private final DurationValidationService durationValidationService;
    private final MediaFileRepository mediaFileRepository;
    private final MeetingRepository meetingRepository;

    // chunk = 5 MB
    private static final long CHUNK_SIZE = 5L * 1024 * 1024;

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

        UUID uploadSessionId = UUID.randomUUID();

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

        uploadSessionRedisService.save(session);
        return UploadInitResponse.builder()
                .uploadSessionId(uploadSessionId.toString())
                .chunkSize(CHUNK_SIZE)
                .totalChunks(totalChunks)
                .status(UploadSessionStatus.INITIATED.name())
                .build();
    }

    private User getCurrentUser() {
        Authentication authentication = SecurityContextHolder
                .getContext()
                .getAuthentication();

        if (authentication == null || !authentication.isAuthenticated()) {
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
        return fileName.substring(lastDot + 1).toLowerCase();
    }

    @Override
    public ChunkUploadResponse uploadChunk(ChunkUploadRequest request) {
        if (request == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
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

        if (uploadSessionRedisService.isChunkUploaded(uploadSessionId, chunkIndex)) {
            throw new BusinessException(
                    HttpStatus.CONFLICT,
                    "CHUNK_ALREADY_EXISTS",
                    "Chunk đã được upload");
        }

        String checksumMD5 = request.getChecksumMD5();
        if (checksumMD5 == null || checksumMD5.isBlank()) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_CHUNKSUM",
                    "Checksum MD5 không được để trống");
        }

        String calculatedMD5;
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] fileBytes = file.getBytes();
            byte[] digest = md.digest(fileBytes);
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

        if (!calculatedMD5.equalsIgnoreCase(checksumMD5.trim())) {
            return ChunkUploadResponse.builder()
                    .uploadSessionId(sessionIdString)
                    .chunkIndex(chunkIndex)
                    .status("CHECKSUM_MISMATCH")
                    .message("Chunk checksum du lieu khong khop")
                    .build();
        }

        String objectKey = "tmp/"
                + uploadSessionId
                + "/chunk_"
                + chunkIndex;

        try {
            minioService.upLoad(file, objectKey);
        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "ERR_MINIO_UNAVAILABLE",
                    "Không thể lưu chunk vào MinIO");
        }

        uploadSessionRedisService.markChunkUploaded(uploadSessionId, chunkIndex);
        int receivedChunks = session.getReceivedChunks();
        session.setReceivedChunks(receivedChunks + 1);

        if (session.getStatus() == UploadSessionStatus.INITIATED) {
            session.setStatus(UploadSessionStatus.UPLOADING);
        }

        uploadSessionRedisService.save(session);
        return ChunkUploadResponse.builder()
                .uploadSessionId(sessionIdString)
                .chunkIndex(chunkIndex)
                .status("SUCCESS")
                .message(objectKey)
                .build();
    }

    @Override
    @Transactional
    public MergeUploadReponse mergeUpload(MergeUploadRequest request) {
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

        User currUser = getCurrentUser();
        UploadSession session = uploadSessionRedisService.get(uploadSessionId);
        if (session == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "UPLOAD_SESSION_NOT_FOUND",
                    "không tìm thấy upload session ");
        }

        if (!session.getUserId().equals(currUser.getId())) {
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
                    "Upload session không ở trạng thái cho phép merge");
        }

        Integer totalChunk = session.getTotalChunks();
        if (totalChunk == null || totalChunk <= 0) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_TOTAL_CHUNKS",
                    "total chunk không hợp lệ ");
        }

        List<Integer> missingChunk = new ArrayList<>();
        for (int i = 0; i < totalChunk; i++) {
            boolean uploaded = uploadSessionRedisService.isChunkUploaded(uploadSessionId, i);
            if (!uploaded) {
                missingChunk.add(i);
            }
        }

        if (!missingChunk.isEmpty()) {
            throw new BusinessException(
                    HttpStatus.CONFLICT,
                    "UPLOAD_INCOMPLETE",
                    "1 so phan bi thieu :" + missingChunk);
        }

        List<String> chunkObjectKeys = new ArrayList<>();
        for (int i = 0; i < totalChunk; i++) {
            String chunkObjectKey = "tmp/"
                    + uploadSessionId
                    + "/chunk_"
                    + i;
            chunkObjectKeys.add(chunkObjectKey);
        }

        String fileName = request.getFileName();
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

        String finalObjectKey = "meetings/"
                + currUser.getId()
                + "/"
                + uploadSessionId
                + "/"
                + fileName;

        try {
            minioService.composeObjects(finalObjectKey, chunkObjectKeys);
        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "ERR_MINIO_COMPOSE",
                    "Không thể merge các chunk trong MinIO");
        }

        try {
            validateMediaDuration(finalObjectKey);
        } catch (BusinessException e) {
            try {
                minioService.delete(finalObjectKey);
            } catch (Exception ignored) {}
            session.setStatus(UploadSessionStatus.FAILED);
            uploadSessionRedisService.save(session);
            throw e;
        }

        for (String chunkObjectKey : chunkObjectKeys) {
            try {
                minioService.delete(chunkObjectKey);
            } catch (Exception ignored) {}
        }

        UUID workspaceId = session.getWorkspaceId() != null ? session.getWorkspaceId() : currUser.getId();
        String mimeType = determineMimeType(fileName);

        MediaFile mediaFile = MediaFile.builder()
                .workspace_id(workspaceId)
                .uploaded_by(currUser.getId())
                .original_name(fileName)
                .object_key(finalObjectKey)
                .mime_type(mimeType)
                .file_size_bytes(session.getFileSize() != null ? session.getFileSize() : 0L)
                .status("UPLOADED")
                .build();
        MediaFile savedMediaFile = mediaFileRepository.save(mediaFile);

        Meeting meeting = Meeting.builder()
                .workspace_id(workspaceId)
                .media_file_id(savedMediaFile.getId())
                .title(fileName)
                .status(MeetingStatus.PENDING)
                .build();
        Meeting savedMeeting = meetingRepository.save(meeting);

        session.setStatus(UploadSessionStatus.COMPLETED);
        uploadSessionRedisService.save(session);

        return MergeUploadReponse.builder()
                .uploadSessionId(sessionIdString)
                .fileName(fileName)
                .fileUrl(finalObjectKey)
                .status(UploadSessionStatus.COMPLETED.name())
                .mediaFileId(savedMediaFile.getId())
                .meetingId(savedMeeting.getId())
                .build();
    }

    private String determineMimeType(String fileName) {
        if (fileName == null) return "application/octet-stream";
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".m4a")) return "audio/mp4";
        if (lower.endsWith(".mkv")) return "video/x-matroska";
        return "application/octet-stream";
    }

    private void validateMediaDuration(String objectKey) {
        Path temFile = null;
        try {
            InputStream inputStream = minioService.downloadObject(objectKey);
            temFile = Files.createTempFile("smartrec-", ".media");
            Files.copy(inputStream, temFile, StandardCopyOption.REPLACE_EXISTING);
            durationValidationService.validateDuration(temFile.toString());
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_MEDIA_METADATA_READ_FAILED",
                    "Không thể kiểm tra metadata của media");
        } finally {
            if (temFile != null) {
                try {
                    Files.deleteIfExists(temFile);
                } catch (Exception ignored) {}
            }
        }
    }
}
