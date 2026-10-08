package com.example.smartrec.service.impl;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.ResourceNotFoundException;
import com.example.smartrec.model.dto.CreateJobRequest;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.JobService;
import com.example.smartrec.service.MeetingProcessingService;
import com.example.smartrec.service.MinioService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class MeetingProcessingServiceImpl implements MeetingProcessingService {
    private final MeetingRepository meetingRepository;
    private final MediaFileRepository mediaFileRepository;
    private final UserRepository userRepository;
    private final MinioService minioService;
    private final JobService jobService;

    @Override
    @Transactional
    public JobResponse processMeeting(UUID meetingId) {
        User currentUser = getCurrentUser();
        Meeting meeting = meetingRepository.findByIdForUpdate(meetingId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "MEETING_NOT_FOUND", "Không tìm thấy cuộc họp"));
        if (!meeting.getWorkspace_id().equals(currentUser.getId())) {
            throw new BusinessException(HttpStatus.FORBIDDEN, "MEETING_ACCESS_DENIED",
                    "Bạn không có quyền truy cập cuộc họp này");
        }

        if (meeting.getActive_job_id() != null) {
            JobResponse activeJob = jobService.getJob(meeting.getActive_job_id());
            if (isActiveJobStatus(activeJob.getStatus())) {
                return activeJob;
            }
        }
        if (meeting.getStatus() != MeetingStatus.UNPROCESSED) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEETING_NOT_UNPROCESSED",
                    "Cuộc họp không ở trạng thái chờ xử lý AI");
        }

        MediaFile mediaFile = mediaFileRepository.findById(meeting.getMedia_file_id())
                .orElseThrow(() -> new ResourceNotFoundException(
                        "MEDIA_FILE_NOT_FOUND", "Không tìm thấy file của cuộc họp"));
        if (MediaFileStatus.TRASHED.equals(mediaFile.getStatus())) {
            throw new ResourceNotFoundException(
                    "MEDIA_FILE_IN_TRASH", "File của cuộc họp đang nằm trong thùng rác");
        }
        if (mediaFile.getObject_key() == null || mediaFile.getObject_key().isBlank()
                || !minioService.objectExists(mediaFile.getObject_key())) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEETING_MEDIA_NOT_READY",
                    "File cuộc họp chưa sẵn sàng để xử lý");
        }
        return jobService.createJob(new CreateJobRequest(mediaFile.getId()));
    }

    private boolean isActiveJobStatus(JobStatus status) {
        return status == JobStatus.PENDING || status == JobStatus.QUEUED
                || status == JobStatus.PROCESSING || status == JobStatus.RUNNING
                || status == JobStatus.RETRYING;
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
