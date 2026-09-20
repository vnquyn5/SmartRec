package com.example.smartrec.service.impl;

import java.time.LocalDate;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.FileUploadResponse;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.FileService;
import com.example.smartrec.service.MinioService;

import lombok.AllArgsConstructor;

@Service
@AllArgsConstructor
public class FileServiceImpl implements FileService {
    private final MediaFileRepository mediaFileRepository;
    private final MeetingRepository meetingRepository;
    private final UserRepository userRepository;
    private final MinioService minioService;

    private static final long MAX_FILE_SIZE = 2L * 1024 * 1024 * 1024;

    @Override
    public FileUploadResponse upLoadFile(MultipartFile file, String title) {
        validateFile(file);
        String originalName = file.getOriginalFilename();
        String safeFileName = sanitizeFileName(originalName);

        User user = getCurrentUser();
        UUID userId = user.getId();
        UUID workspaceId = userId;
        LocalDate now = LocalDate.now();
        String objectKey = userId
                + "/"
                + now.getYear()
                + "/"
                + String.format(
                        "%02d",
                        now.getMonthValue())
                + "/"
                + UUID.randomUUID()
                + "_"
                + safeFileName;

        try {

            minioService.upLoad(file,objectKey );

        } catch (Exception e) {
            e.printStackTrace();
            throw new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, "ERR_MINIO_UNAVAILABLE", "Không thể kết nối hoặc upload file lên MinIO"
            );
        }
        MediaFile mediaFile=MediaFile.builder()
                                     .workspace_id(workspaceId)
                                     .uploaded_by(userId)
                                     .original_name(safeFileName)
                                     .object_key(objectKey)
                                     .mime_type(file.getContentType())
                                     .file_size_bytes(file.getSize())
                                     .status("UPLOADED")
                                     .build();
        MediaFile savedMediaFile =mediaFileRepository.save(mediaFile);

        Meeting meeting = Meeting.builder()
                                  .workspace_id(workspaceId)
                                  .media_file_id(savedMediaFile.getId())
                                  .title(title == null || title.isBlank() ? safeFileName :title)
                      .status(MeetingStatus.PENDING)
                                  .build();
        Meeting savedMeeting = meetingRepository.save(meeting);
          return new FileUploadResponse(
                savedMediaFile.getId(),
                savedMeeting.getId(),
                savedMediaFile.getOriginal_name(),
                savedMediaFile.getObject_key(),
                savedMediaFile.getMime_type(),
                savedMediaFile.getFile_size_bytes(),
                savedMediaFile.getDuration_seconds(),
                savedMediaFile.getStatus(),
                savedMeeting.getStatus().name()
        );
    }

    private void validateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,"ERR_FILE_EMPTY","File không được để trống ");
        }
        if (file.getSize() > MAX_FILE_SIZE) {
            throw new BusinessException(HttpStatus.PAYLOAD_TOO_LARGE,"ERR_FILE_TOO_LARGE","File không vượt quá 2GB");
        }
        String fileName = file.getOriginalFilename();
        if (fileName == null || fileName.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,"ERR_INVALID_FILENAME","Tên file không hợp lệ");
        }
        String lowerName = fileName.toLowerCase();
        boolean validExtension = lowerName.endsWith(".mp4") || lowerName.endsWith(".mkv") ||
                lowerName.endsWith(".mp3") || lowerName.endsWith(".m4a");

        if (!validExtension) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,"ERR_INVALID_FILE_TYPE","Chỉ hổ trợ file .mp4, .mkv, .mp3, .m4a");
        }

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

}
