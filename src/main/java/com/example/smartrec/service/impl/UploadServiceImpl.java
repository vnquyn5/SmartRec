package com.example.smartrec.service.impl;

import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import com.example.smartrec.enums.UploadSessionStatus;

import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.UploadSession;
import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.UploadService;
import com.example.smartrec.service.UploadSessionRedisService;

import lombok.AllArgsConstructor;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class UploadServiceImpl implements UploadService {
    private final UserRepository userRepository;
    private final UploadSessionRedisService uploadSessionRedisService;

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

        // luu upload session vao redis 
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
}
