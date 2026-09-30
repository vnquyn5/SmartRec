package com.example.smartrec.service.impl;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
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
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.FileService;
import com.example.smartrec.service.MinioService;

import lombok.AllArgsConstructor;

@Service
@AllArgsConstructor
public class FileServiceImpl implements FileService {
    private static final Logger log = LoggerFactory.getLogger(FileServiceImpl.class);

    private static final long MAX_FILE_SIZE = 2L * 1024 * 1024 * 1024;
    private static final int SIMPLE_UPLOAD_PRESIGN_EXPIRES_SECONDS = 20 * 60;

    private final MediaFileRepository mediaFileRepository;
    private final MeetingRepository meetingRepository;
    private final UserRepository userRepository;
    private final MinioService minioService;

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
                title);
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
        String objectKey = buildObjectKey(user, safeFileName);

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
    @Transactional
    public FileUploadResponse completeSimpleUpload(SimpleUploadCompleteRequest request) {
        long totalStartNanos = System.nanoTime();
        if (request == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Upload request không được null");
        }
        validateSimpleUploadMetadata(request.getFileName(), request.getFileSize(), request.getMimeType());

        User user = getCurrentUser();
        UUID userId = user.getId();
        UUID workspaceId = userId;
        String safeFileName = sanitizeFileName(request.getFileName());
        String expectedObjectKey = buildObjectKey(user, safeFileName);
        log.info(
                "[simple-upload] complete received objectKey={}, expectedObjectKey={}, fileName={}, safeFileName={}, requestFileSize={}, mimeType={}, titlePresent={}, userId={}, workspaceId={}",
                request.getObjectKey(),
                expectedObjectKey,
                request.getFileName(),
                safeFileName,
                request.getFileSize(),
                request.getMimeType(),
                request.getTitle() != null && !request.getTitle().isBlank(),
                userId,
                workspaceId);
        if (!expectedObjectKey.equals(request.getObjectKey())) {
            log.warn("[simple-upload] complete rejected objectKey mismatch received={}, expected={}, userId={}",
                    request.getObjectKey(), expectedObjectKey, userId);
            throw new BusinessException(HttpStatus.FORBIDDEN, "INVALID_OBJECT_KEY",
                    "Object key không thuộc upload hiện tại");
        }

        FileUploadResponse existing = findExistingUploadResponse(request.getObjectKey(), userId);
        if (existing != null) {
            log.info("[simple-upload] complete idempotent hit objectKey={}, mediaFileId={}, meetingId={}, totalMs={}",
                    request.getObjectKey(), existing.getId(), existing.getMeetingId(), elapsedMs(totalStartNanos));
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
        log.info("[simple-upload] complete statObject objectKey={}, sizeBytes={}, elapsedMs={}",
                request.getObjectKey(), objectSize, elapsedMs(statStartNanos));

        if (objectSize != request.getFileSize()) {
            log.warn("[simple-upload] complete rejected size mismatch objectKey={}, statSizeBytes={}, requestSizeBytes={}",
                    request.getObjectKey(), objectSize, request.getFileSize());
            throw new BusinessException(HttpStatus.BAD_REQUEST, "OBJECT_SIZE_MISMATCH",
                    "Kích thước object trên MinIO không khớp metadata upload");
        }

        FileUploadResponse response = createUploadRecords(
                workspaceId,
                userId,
                safeFileName,
                request.getObjectKey(),
                normalizeMimeType(request.getMimeType()),
                request.getFileSize(),
                request.getTitle());
        log.info("[simple-upload] complete finished objectKey={}, mediaFileId={}, meetingId={}, totalMs={}",
                request.getObjectKey(), response.getId(), response.getMeetingId(), elapsedMs(totalStartNanos));
        return response;
    }

    private FileUploadResponse createUploadRecords(
            UUID workspaceId,
            UUID userId,
            String safeFileName,
            String objectKey,
            String mimeType,
            Long fileSize,
            String title) {
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
                .status(MediaFileStatus.UPLOADED)
                .build();
        MediaFile savedMediaFile;
        long mediaFileSaveStartNanos = System.nanoTime();
        try {
            savedMediaFile = mediaFileRepository.saveAndFlush(mediaFile);
            log.info("[simple-upload] MediaFile DB save success mediaFileId={}, objectKey={}, elapsedMs={}",
                    savedMediaFile.getId(), objectKey, elapsedMs(mediaFileSaveStartNanos));
        } catch (DataAccessException e) {
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
        }

        long meetingSaveStartNanos = System.nanoTime();
        Meeting meeting = Meeting.builder()
                .workspace_id(workspaceId)
                .media_file_id(savedMediaFile.getId())
                .title(title == null || title.isBlank() ? safeFileName : title)
                .status(MeetingStatus.PENDING)
                .build();
        Meeting savedMeeting;
        try {
            savedMeeting = meetingRepository.saveAndFlush(meeting);
            log.info("[simple-upload] Meeting DB save success meetingId={}, mediaFileId={}, workspaceId={}, title={}, status={}, elapsedMs={}",
                    savedMeeting.getId(),
                    savedMediaFile.getId(),
                    workspaceId,
                    meeting.getTitle(),
                    MeetingStatus.PENDING,
                    elapsedMs(meetingSaveStartNanos));
        } catch (DataAccessException e) {
            log.error(
                    "[simple-upload] Meeting DB save failed mediaFileId={}, workspaceId={}, title={}, status={}",
                    savedMediaFile.getId(),
                    workspaceId,
                    meeting.getTitle(),
                    MeetingStatus.PENDING,
                    e);
            throw e;
        }

        return toFileUploadResponse(savedMediaFile, savedMeeting);
    }

    private FileUploadResponse findExistingUploadResponse(String objectKey, UUID userId) {
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

        Meeting meeting = meetingRepository.findByMediaFileId(mediaFile.getId())
                .orElseGet(() -> {
                    long meetingSaveStartNanos = System.nanoTime();
                    log.warn("[simple-upload] complete repairing missing Meeting for mediaFileId={}, objectKey={}",
                            mediaFile.getId(), objectKey);
                    Meeting repairedMeeting = meetingRepository.saveAndFlush(Meeting.builder()
                            .workspace_id(mediaFile.getWorkspace_id())
                            .media_file_id(mediaFile.getId())
                            .title(mediaFile.getOriginal_name())
                            .status(MeetingStatus.PENDING)
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
        if (fileSize == null || fileSize <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_FILE_EMPTY", "File không được để trống ");
        }
        if (fileSize > MAX_FILE_SIZE) {
            throw new BusinessException(HttpStatus.PAYLOAD_TOO_LARGE, "ERR_FILE_TOO_LARGE", "File không vượt quá 2GB");
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
        normalizeMimeType(mimeType);
    }

    private String buildObjectKey(User user, String safeFileName) {
        String accountName = sanitizeAccountName(user.getFull_name());
        LocalDate now = LocalDate.now();
        return accountName
                + "/"
                + String.format("%02d", now.getMonthValue())
                + "-" + now.getYear()
                + "/"
                + safeFileName;
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

    private long elapsedMs(long startedAtNanos) {
        return (System.nanoTime() - startedAtNanos) / 1_000_000;
    }
}
