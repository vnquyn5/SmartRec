package com.example.smartrec.service.impl;

import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.entity.SlideKeyframe;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.repository.SlideKeyframeRepository;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.SlideKeyframeStorageService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor 
public class SlideKeyframeStorageServiceImpl
        implements SlideKeyframeStorageService {

    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of(
            "image/png",
            "image/jpeg",
            "image/webp");

    private final MinioService minioService;
    private final SlideKeyframeRepository slideKeyframeRepository;

    @Value("${minio.slide-bucket-name:smartrec-slides}")
    private String slideBucketName;


    @Override
    @Transactional
    public SlideKeyframe uploadKeyframe(
            UUID meetingId,
            Long timestampMs,
            MultipartFile file) {

        validateRequest(meetingId, timestampMs, file);

        String contentType = file.getContentType();

        if (contentType == null
                || !ALLOWED_CONTENT_TYPES.contains(
                        contentType.toLowerCase())) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_INVALID_KEYFRAME_TYPE",
                    "Chỉ hỗ trợ ảnh PNG, JPEG và WebP");
        }

        UUID keyframeId = UUID.randomUUID();
        String extension = getExtension(contentType);

        // Object key được tạo theo meeting ID và keyframe ID.
        String objectKey = "meetings/"
                + meetingId
                + "/keyframes/"
                + keyframeId
                + "."
                + extension;

        String checksum;

        try {
            byte[] fileBytes = file.getBytes();

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            checksum = HexFormat.of().formatHex(
                    digest.digest(fileBytes));

            // Bước 1: Upload ảnh lên bucket smartrec-slides.
            minioService.upLoadToBucket(
                    file,
                    slideBucketName,
                    objectKey);

            // Bước 2: Kiểm tra object đã tồn tại trên MinIO.
            if (!minioService.objectExists(
                    slideBucketName,
                    objectKey)) {
                throw new IllegalStateException(
                        "Keyframe không tồn tại sau khi upload");
            }

        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "ERR_KEYFRAME_STORAGE_FAILED",
                    "Không thể lưu ảnh Keyframe vào MinIO");
        }

        SlideKeyframe keyframe = new SlideKeyframe();
        keyframe.setId(keyframeId);
        keyframe.setMeetingId(meetingId);
        keyframe.setTimestampMs(timestampMs);
        keyframe.setImageObjectKey(objectKey);
        keyframe.setContentType(contentType);
        keyframe.setSizeBytes(file.getSize());
        keyframe.setChecksumSha256(checksum);

        try {
            // Chỉ lưu metadata sau khi upload ảnh thành công.
            return slideKeyframeRepository.saveAndFlush(keyframe);

        } catch (RuntimeException e) {
            // DB lỗi sau khi upload: cố gắng xóa object để tránh file rác.
            try {
                minioService.delete(slideBucketName, objectKey);
            } catch (Exception cleanupException) {
                e.addSuppressed(cleanupException);
            }

            throw e;
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<SlideKeyframe> getKeyframes(UUID meetingId) {
        if (meetingId == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_INVALID_MEETING_ID",
                    "Meeting ID không được để trống");
        }

        return slideKeyframeRepository
                .findByMeetingIdOrderByTimestampMsAsc(meetingId);
    }

    private void validateRequest(
            UUID meetingId,
            Long timestampMs,
            MultipartFile file) {

        if (meetingId == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_INVALID_MEETING_ID",
                    "Meeting ID không hợp lệ");
        }

        if (timestampMs == null || timestampMs < 0) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_INVALID_TIMESTAMP",
                    "Timestamp phải lớn hơn hoặc bằng 0");
        }

        if (file == null || file.isEmpty()) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_EMPTY_KEYFRAME",
                    "File ảnh Keyframe không được để trống");
        }
    }

    private String getExtension(String contentType) {
        return switch (contentType.toLowerCase()) {
            case "image/png" -> "png";
            case "image/jpeg" -> "jpg";
            case "image/webp" -> "webp";
            default -> throw new IllegalArgumentException(
                    "Unsupported image content type");
        };
    }
}