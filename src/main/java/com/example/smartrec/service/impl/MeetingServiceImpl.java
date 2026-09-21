package com.example.smartrec.service.impl;

import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.MinioOperationException;
import com.example.smartrec.exception.ResourceNotFoundException;
import com.example.smartrec.model.dto.MeetingFilterRequest;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.RenameFileRequest;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.MeetingService;
import com.example.smartrec.service.MinioService;

import lombok.AllArgsConstructor;

@Service
@AllArgsConstructor
public class MeetingServiceImpl implements MeetingService {
    private static final int DEFAULT_PAGE = 0;
    private static final int DEFAULT_SIZE = 20;
    private static final int MAX_SIZE = 100;

    private final MeetingRepository meetingRepository;
    private final MediaFileRepository mediaFileRepository;
    private final UserRepository userRepository;
    private final MinioService minioService;

    @Override
    public PageResponse<MeetingResponseDTO> findMeetings(MeetingFilterRequest request) {
        User currentUser = getCurrentUser();
        int page = request.getPage() == null ? DEFAULT_PAGE : request.getPage();
        int size = request.getSize() == null ? DEFAULT_SIZE : request.getSize();
        if (page < 0 || size < 1 || size > MAX_SIZE) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_PAGINATION",
                    "page phải lớn hơn hoặc bằng 0 và size phải trong khoảng 1-100");
        }

        MeetingStatus status = parseStatus(request.getStatus());
        String keyword = request.getKeyword();
        if (keyword != null) {
            keyword = keyword.trim();
            if (keyword.isEmpty()) {
                keyword = null;
            }
        }
        Pageable pageable = PageRequest.of(page, size, parseSort(request.getSort()));
        Page<Meeting> meetings = meetingRepository.searchMeetings(currentUser.getId(), status, keyword, pageable);

        return new PageResponse<>(
                meetings.getContent().stream().map(this::toResponse).toList(),
                meetings.getNumber(),
                meetings.getSize(),
                meetings.getTotalElements(),
                meetings.getTotalPages());
    }

    @Override
    @Transactional
    public void deleteMeeting(UUID meetingId) {
        User currentUser = getCurrentUser();
        Meeting meeting = meetingRepository.findById(meetingId)
                .filter(item -> item.getWorkspace_id().equals(currentUser.getId()))
                .orElseThrow(() -> new ResourceNotFoundException(
                        "MEETING_NOT_FOUND", "Không tìm thấy cuộc họp hoặc bạn không có quyền truy cập"));

        MediaFile mediaFile = mediaFileRepository.findById(meeting.getMedia_file_id())
                .orElseThrow(() -> new ResourceNotFoundException(
                        "MEDIA_FILE_NOT_FOUND", "Không tìm thấy file của cuộc họp"));

        try {
            minioService.delete(mediaFile.getObject_key());
        } catch (Exception ex) {
            throw new MinioOperationException("Không thể xóa file trên MinIO", ex);
        }

        meetingRepository.delete(meeting);
        mediaFileRepository.delete(mediaFile);
    }

        @Override
        @Transactional
        public MeetingResponseDTO renameMeeting(UUID meetingId, RenameFileRequest request) {
        User currentUser = getCurrentUser();
        Meeting meeting = meetingRepository.findById(meetingId)
            .filter(item -> item.getWorkspace_id().equals(currentUser.getId()))
            .orElseThrow(() -> new ResourceNotFoundException(
                "MEETING_NOT_FOUND", "Không tìm thấy cuộc họp hoặc bạn không có quyền truy cập"));

        String fileName = request == null || request.getFileName() == null
            ? ""
            : request.getFileName().trim();
        if (fileName.isBlank() || fileName.length() > 500
            || !fileName.matches("[A-Za-z0-9._-]+")
            || !(fileName.toLowerCase().endsWith(".mp3")
                || fileName.toLowerCase().endsWith(".mp4")
                || fileName.toLowerCase().endsWith(".m4a")
                || fileName.toLowerCase().endsWith(".mkv"))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_FILENAME", "Tên file không hợp lệ");
        }

        MediaFile mediaFile = mediaFileRepository.findById(meeting.getMedia_file_id())
            .orElseThrow(() -> new ResourceNotFoundException(
                "MEDIA_FILE_NOT_FOUND", "Không tìm thấy file của cuộc họp"));
        mediaFile.setOriginal_name(fileName);
        mediaFileRepository.save(mediaFile);
        return toResponse(meeting);
        }

    private MeetingResponseDTO toResponse(Meeting meeting) {
        MediaFile mediaFile = mediaFileRepository.findById(meeting.getMedia_file_id()).orElse(null);
        return new MeetingResponseDTO(
                meeting.getId(),
                meeting.getTitle(),
                meeting.getStatus(),
                meeting.getMedia_file_id(),
                mediaFile == null ? null : mediaFile.getOriginal_name(),
                mediaFile == null ? null : mediaFile.getMime_type(),
                mediaFile == null ? null : mediaFile.getFile_size_bytes(),
                mediaFile == null ? null : mediaFile.getDuration_seconds(),
                meeting.getCreated_at(),
                meeting.getUpdated_at());
    }

    private MeetingStatus parseStatus(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return MeetingStatus.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_MEETING_STATUS",
                    "status phải là PENDING, PROCESSING, COMPLETED hoặc FAILED");
        }
    }

    private Sort parseSort(String value) {
        String sortValue = value == null || value.isBlank() ? "created_at,desc" : value.trim();
        String[] parts = sortValue.split(",", -1);
        String property = parts[0];
        if (!property.equals("created_at") && !property.equals("updated_at")
                && !property.equals("title") && !property.equals("status")) {
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