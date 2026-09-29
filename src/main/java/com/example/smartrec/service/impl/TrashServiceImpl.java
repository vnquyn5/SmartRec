package com.example.smartrec.service.impl;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.MinioOperationException;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.TrashFilterRequest;
import com.example.smartrec.model.dto.TrashMediaFileResponse;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.TrashService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class TrashServiceImpl implements TrashService {
    private static final int DEFAULT_PAGE = 0;
    private static final int DEFAULT_SIZE = 20;
    private static final int MAX_SIZE = 100;

    private final MediaFileRepository mediaFileRepository;
    private final MeetingRepository meetingRepository;
    private final UserRepository userRepository;
    private final MinioService minioService;

    @Value("${trash.retention-days:30}")
    private long retentionDays;

    @Override
    @Transactional(readOnly = true)
    public PageResponse<TrashMediaFileResponse> findTrash(TrashFilterRequest request) {
        User currentUser = getCurrentUser();
        int page = request.getPage() == null ? DEFAULT_PAGE : request.getPage();
        int size = request.getSize() == null ? DEFAULT_SIZE : request.getSize();
        if (page < 0 || size < 1 || size > MAX_SIZE) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_PAGINATION",
                    "page phải lớn hơn hoặc bằng 0 và size phải trong khoảng 1-100");
        }

        String keyword = request.getKeyword();
        if (keyword != null) {
            keyword = keyword.trim();
            if (keyword.isEmpty()) {
                keyword = null;
            }
        }

        Pageable pageable = PageRequest.of(page, size, parseSort(request.getSort()));
        Page<MediaFile> trashPage = mediaFileRepository.searchTrash(currentUser.getId(), keyword, Instant.now(),
                pageable);
        return new PageResponse<>(
                trashPage.getContent().stream().map(this::toResponse).toList(),
                trashPage.getNumber(),
                trashPage.getSize(),
                trashPage.getTotalElements(),
                trashPage.getTotalPages());
    }

    @Override
    @Transactional
    public TrashMediaFileResponse moveToTrash(UUID mediaFileId) {
        User currentUser = getCurrentUser();
        MediaFile mediaFile = getMediaFileForUser(mediaFileId, currentUser);
        if (MediaFileStatus.TRASHED.equals(mediaFile.getStatus())) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEDIA_ALREADY_TRASHED",
                    "File đã nằm trong thùng rác");
        }

        Instant now = Instant.now();
        mediaFile.setPrevious_status(mediaFile.getStatus());
        mediaFile.setStatus(MediaFileStatus.TRASHED);
        mediaFile.setDeleted_at(now);
        mediaFile.setPurge_at(now.plusSeconds(retentionDays * 24 * 60 * 60));
        mediaFile.setDeleted_by(currentUser.getId());
        return toResponse(mediaFileRepository.save(mediaFile));
    }

    @Override
    @Transactional
    public TrashMediaFileResponse restore(UUID mediaFileId) {
        User currentUser = getCurrentUser();
        MediaFile mediaFile = getMediaFileForUser(mediaFileId, currentUser);
        if (!MediaFileStatus.TRASHED.equals(mediaFile.getStatus())) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEDIA_NOT_IN_TRASH",
                    "File không nằm trong thùng rác");
        }

        String restoredStatus = mediaFile.getPrevious_status();
        if (restoredStatus == null || restoredStatus.isBlank() || MediaFileStatus.TRASHED.equals(restoredStatus)
                || MediaFileStatus.PURGED.equals(restoredStatus)) {
            restoredStatus = MediaFileStatus.UPLOADED;
        }

        mediaFile.setStatus(restoredStatus);
        mediaFile.setPrevious_status(null);
        mediaFile.setDeleted_at(null);
        mediaFile.setPurge_at(null);
        mediaFile.setDeleted_by(null);
        return toResponse(mediaFileRepository.save(mediaFile));
    }

    @Override
    @Transactional
    public void permanentDelete(UUID mediaFileId) {
        User currentUser = getCurrentUser();
        MediaFile mediaFile = getMediaFileForUser(mediaFileId, currentUser);
        if (!MediaFileStatus.TRASHED.equals(mediaFile.getStatus())) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEDIA_NOT_IN_TRASH",
                    "Chỉ có thể xóa vĩnh viễn file đang ở thùng rác");
        }
        deleteMinioThenDatabase(mediaFile);
    }

    @Transactional
    public void deleteMinioThenDatabase(MediaFile mediaFile) {
        try {
            minioService.delete(mediaFile.getObject_key());
        } catch (Exception ex) {
            throw new MinioOperationException("MINIO_DELETE_FAILED", "Không thể xóa object trên MinIO", ex);
        }

        meetingRepository.findByMediaFileId(mediaFile.getId()).ifPresent(meetingRepository::delete);
        mediaFileRepository.delete(mediaFile);
    }

    private MediaFile getMediaFileForUser(UUID mediaFileId, User currentUser) {
        return mediaFileRepository.findById(mediaFileId)
                .filter(mediaFile -> mediaFile.getUploaded_by().equals(currentUser.getId()))
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "MEDIA_NOT_FOUND",
                        "Không tìm thấy file hoặc bạn không có quyền truy cập"));
    }

    private TrashMediaFileResponse toResponse(MediaFile mediaFile) {
        Instant now = Instant.now();
        Instant purgeAt = mediaFile.getPurge_at();
        long daysRemaining = purgeAt == null ? retentionDays
                : Math.max(0, Duration.between(now, purgeAt).toDays() + 1);
        return new TrashMediaFileResponse(
                mediaFile.getId(),
                mediaFile.getOriginal_name(),
                mediaFile.getObject_key(),
                mediaFile.getFile_size_bytes(),
                mediaFile.getMime_type(),
                mediaFile.getStatus(),
                mediaFile.getPrevious_status(),
                mediaFile.getDeleted_at(),
                purgeAt,
                daysRemaining);
    }

    private Sort parseSort(String value) {
        String sortValue = value == null || value.isBlank() ? "deleted_at,desc" : value.trim();
        String[] parts = sortValue.split(",", -1);
        String property = parts[0];
        if (!property.equals("deleted_at") && !property.equals("purge_at")
                && !property.equals("original_name") && !property.equals("file_size_bytes")) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_SORT", "Trường sort không được hỗ trợ");
        }
        Sort.Direction direction = parts.length > 1 && parts[1].equalsIgnoreCase("asc")
                ? Sort.Direction.ASC
                : Sort.Direction.DESC;
        return Sort.by(direction, property);
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
                        HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "Không tìm thấy người dùng đăng nhập"));
    }
}
