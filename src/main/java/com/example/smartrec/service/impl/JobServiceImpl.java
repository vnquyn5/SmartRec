package com.example.smartrec.service.impl;

import org.springframework.stereotype.Service;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.enums.PipelineStage;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.CreateJobRequest;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.model.dto.WorkerCallbackRequest;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobStageRepository;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.JobQueueService;
import com.example.smartrec.service.JobService;

import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class JobServiceImpl implements JobService {
    private final JobRepository jobRepository;
    private final JobStageRepository jobStageRepository;
    private final JobQueueService jobQueueService;
    private final MediaFileRepository mediaFileRepository;
    private final SpeakerSegmentRepository speakerSegmentRepository;
    private final MeetingRepository meetingRepository;
    @Value("${job.max-retry:5}") // doc cau hinh trong yml
    private int maxRetry;

    @Override
    @Transactional
    public JobResponse createJob(CreateJobRequest request) {

        if (request == null || request.getMediaFileId() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_REQUEST",
                    "mediaFileId không được để trống");
        }

        Meeting meeting = meetingRepository.findByMediaFileId(request.getMediaFileId())
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "MEETING_NOT_FOUND",
                        "Không tìm thấy cuộc họp liên kết với mediaFileId: " + request.getMediaFileId()));

        Instant now = Instant.now();
        Job job = Job.builder()
                .mediaFileId(request.getMediaFileId())
                .meetingId(meeting.getId())
                .status(JobStatus.PENDING)
                .currentStage(PipelineStage.FFMPEG)
                .retryCount(0)
                .createdAt(now)
                .updatedAt(now)
                .build();

        job.setStatus(JobStatus.QUEUED);
        job.setUpdatedAt(Instant.now());
        jobRepository.save(job);

        for (PipelineStage stage : PipelineStage.values()) {
            JobStage jobStage = JobStage.builder()
                    .jobId(job.getId())
                    .stage(stage)
                    .status(JobStageStatus.PENDING)
                    .retryCount(0)
                    .createdAt(Instant.now())
                    .build();

            jobStageRepository.save(jobStage);
        }

        // cap nhat job sang queue
        job.setStatus(JobStatus.QUEUED);
        jobRepository.save(job);
        UUID jobId = job.getId();
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    jobQueueService.enqueueJob(jobId);
                }
            });
        } else {
            jobQueueService.enqueueJob(jobId);
        }
        return toResponse(job);
    }

    @Override
    @Transactional(readOnly = true)
    public JobResponse getJob(UUID jobId) {
        Job job = findJob(jobId);
        String objectKey = mediaFileRepository.findById(job.getMediaFileId())
                .map(MediaFile::getObject_key)
                .orElse(null);

        return JobResponse.builder()
                .id(job.getId())
                .meetingId(job.getMeetingId())
                .mediaFileId(job.getMediaFileId())
                .objectKey(objectKey)
                .status(job.getStatus())
                .stage(job.getCurrentStage())
                .retryCount(job.getRetryCount())
                .errorCode(job.getErrorCode())
                .errorMessage(job.getErrorMessage())
                .failedAt(job.getFailedAt())
                .lastRetryAt(job.getLastRetryAt())
                .createdAt(job.getCreatedAt())
                .updatedAt(job.getUpdatedAt())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<JobResponse> getDLQJob() { // chuyen doi 1 doi tuong entity thanh 1 doi tuong response de tra ve cho
                                           // client
        return jobRepository.findByStatus(JobStatus.DLQ).stream().map(this::toResponse).toList();

    }

    @Override
    @Transactional
    public void processJob(UUID jobId) {
        Job job = findJob(jobId);
        if (job.getStatus() == JobStatus.DLQ) { // Kiem tra job hien tai co phai la DLQ khong
            System.out.println("Job đang ở DLQ, không tự động retry: " + job.getId());
            return;
        }

        if (job.getStatus() == JobStatus.COMPLETED) {
            System.out.println("Job đã COMPLETED: " + job.getId());
            return;
        }
        // Job đã có stage hiện tại
        if (job.getCurrentStage() == null) {
            System.out.println("Job chưa có currentStage: " + job.getId());
            return;
        }
        job.setStatus(JobStatus.PROCESSING);
        jobRepository.save(job);

    }

    @Override
    @Transactional
    public void manualRetry(UUID jobId) {
        Job job = findJob(jobId);

        // chi co DLQ moi duoc retry thu cong
        if (job.getStatus() != JobStatus.DLQ) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_JOB_STATUS",
                    "Chỉ Job ở trạng thái DLQ mới được retry thủ công");
        }
        JobStage failedStage = jobStageRepository
                .findByJobIdOrderByStageAsc(jobId)
                .stream()
                .filter(stage -> stage.getStatus() == JobStageStatus.FAILED)
                .findFirst()
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.BAD_REQUEST,
                        "FAILED_STAGE_NOT_FOUND",
                        "Không tìm thấy stage bị lỗi"));

        // Retry đúng stage bị lỗi
        failedStage.setRetryCount(0);
        failedStage.setStatus(JobStageStatus.RETRYING);

        // Job quay lại đúng stage bị lỗi
        job.setCurrentStage(failedStage.getStage());
        job.setStatus(JobStatus.RETRYING);
        job.setLastRetryAt(Instant.now());

        jobStageRepository.save(failedStage);
        jobRepository.save(job);

        jobQueueService.enqueueRetry(job.getId());

        System.out.println(
                "Manual retry Job: "
                        + job.getId()
                        + " - Stage: "
                        + failedStage.getStage());
    }

    // private void processMedia(UUID jobId){
    // Job job = findJob(jobId);
    // if(job.getStatus() == JobStatus.DLQ){
    // return;
    // }
    // if(job.getStatus() == JobStatus.COMPLETED){
    // return;
    // }
    // job.setStatus(JobStatus.PROCESSING);
    // jobRepository.save(job);
    // }

    private void handleProcessingFailure(Job job, Exception e) {
        job.setStatus(JobStatus.FAILED);
        job.setErrorCode("PROCESSING_ERROR");// luu ma loi
        String errorMessage = e.getMessage();
        if (errorMessage == null || errorMessage.isBlank()) {
            errorMessage = e.getClass().getSimpleName();
        }
        job.setErrorMessage(errorMessage);

        // luu thoi diem loi
        job.setFailedAt(Instant.now());
        jobRepository.save(job);

        // kiem tra retry
        if (job.getRetryCount() < maxRetry) {
            retryJob(job);
        } else {
            moveToDLQ(job);
        }
    }

    private void retryJob(Job job) {
        int nextRetry = job.getRetryCount() + 1;
        job.setRetryCount(nextRetry);
        job.setStatus(JobStatus.RETRYING);
        job.setLastRetryAt(Instant.now());// luu thoi gian retry
        jobRepository.save(job);
        jobQueueService.enqueueRetry(job.getId());// dua job nay vao retry queue
        System.out.println("Retry Job: " + job.getId() + " attempt " + nextRetry + "/" + maxRetry);
    }

    private void moveToDLQ(Job job) {
        job.setStatus(JobStatus.DLQ);// chuyen status thanh DLq
        jobRepository.save(job);
        jobQueueService.enqueueDLQ(job.getId());// dua job id vao DQL redis
        System.out.println("Công việc đã di chuyển đến DLQ" + job.getId());
    }

    private Job findJob(UUID jobId) {
        if (jobId == null) {

            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_JOB_ID",
                    "jobId không được để trống");
        }
        return jobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "JOB_NOT_FOUND",
                        "Không tìm thấy Job: " + jobId));
    }

    private JobResponse toResponse(Job job) {

        return JobResponse.builder()
                .id(job.getId())
                .mediaFileId(job.getMediaFileId())
                .status(job.getStatus())
                .retryCount(job.getRetryCount())
                .errorCode(job.getErrorCode())
                .errorMessage(job.getErrorMessage())
                .failedAt(job.getFailedAt())
                .lastRetryAt(job.getLastRetryAt())
                .createdAt(job.getCreatedAt())
                .updatedAt(job.getUpdatedAt())
                .build();
    }

    @Override
    @Transactional
    public void handleWorkerCallback(UUID jobId, WorkerCallbackRequest request) {
        Job job = findJob(jobId);
        if (request == null || request.getStage() == null || request.getStatus() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_CALLBACK",
                    "Stage không được để trống");
        }
        JobStage jobStage = jobStageRepository.findByJobIdAndStage(jobId, request.getStage())
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "JOB_STAGE_NOT_FOUND",
                        "Không tìm thấy Job Stage"));

        // Idempotency: Nếu stage này đã hoàn thành thành công từ trước, bỏ qua xử lý lại
        if (jobStage.getStatus() == JobStageStatus.SUCCESS) {
            return;
        }

        if (job.getCurrentStage() != request.getStage()) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_STAGE",
                    "Callback không đúng stage hiện tại của Job");
        }

        if (request.getStatus() == JobStageStatus.PROCESSING) {
            job.setStatus(JobStatus.PROCESSING);

            jobStage.setStatus(
                    JobStageStatus.PROCESSING);
            if (jobStage.getStartedAt() == null) {
                jobStage.setStartedAt(Instant.now());
            }
            if (job.getMeetingId() != null) {
                meetingRepository.findById(job.getMeetingId()).ifPresent(meeting -> {
                    if (meeting.getStatus() == MeetingStatus.PENDING) {
                        meeting.setStatus(MeetingStatus.PROCESSING);
                        meetingRepository.save(meeting);
                    }
                });
            }
        } else if (request.getStatus() == JobStageStatus.SUCCESS) {

            jobStage.setStatus(JobStageStatus.SUCCESS);
            jobStage.setCompletedAt(Instant.now());

            if (request.getStage() == PipelineStage.OUTPUT && request.getSegments() != null
                    && !request.getSegments().isEmpty()) {
                if (job.getMeetingId() != null) {
                    speakerSegmentRepository.deleteByMeetingId(job.getMeetingId());
                }
                List<SpeakerSegment> segmentsToSave = request.getSegments().stream()
                        .filter(seg -> seg != null && seg.getStartTime() != null && seg.getEndTime() != null
                                && seg.getEndTime() > seg.getStartTime() && seg.getStartTime() >= 0)
                        .map(seg -> SpeakerSegment.builder()
                                .meetingId(job.getMeetingId())
                                .speakerLabel(seg.getSpeakerLabel() != null && !seg.getSpeakerLabel().isBlank()
                                        ? seg.getSpeakerLabel() : "SPEAKER_00")
                                .startTime(seg.getStartTime())
                                .endTime(seg.getEndTime())
                                .build())
                        .toList();
                if (!segmentsToSave.isEmpty()) {
                    speakerSegmentRepository.saveAll(segmentsToSave);
                }
            }

            moveToNextStage(job, jobStage);
        } else if (request.getStatus() == JobStageStatus.FAILED) {

            handleStageFailure(
                    job,
                    jobStage,
                    request);
        }

        jobStageRepository.save(jobStage);

        jobRepository.save(job);

    }

    private void moveToNextStage(Job job, JobStage currentStage) {
        // lay het cac gia tri enum PipelineStage va dua vao 1 bang
        PipelineStage[] stages = PipelineStage.values();
        // lay vt hien tai cua stage trong enum . ordinal() trả về index bắt đầu từ 0
        int index = currentStage.getStage().ordinal();
        if (index == stages.length - 1) {
            job.setStatus(JobStatus.COMPLETED);
            job.setCurrentStage(null);
            if (job.getMeetingId() != null) {
                meetingRepository.findById(job.getMeetingId()).ifPresent(meeting -> {
                    meeting.setStatus(MeetingStatus.COMPLETED);
                    meetingRepository.save(meeting);
                });
            }
            return;
        }
        // lay stage tieo theo
        PipelineStage nextStage = stages[index + 1];
        job.setStatus(JobStatus.QUEUED);
        job.setCurrentStage(nextStage);
        // jobQueueService.enqueueJob(job.getId());
    }

    private void handleStageFailure(
            Job job,
            JobStage jobStage,
            WorkerCallbackRequest request) {

        jobStage.setStatus(JobStageStatus.FAILED);
        jobStage.setErrorCode("STAGE_PROCESSING_ERROR");
        jobStage.setErrorMessage(request.getErrorMessage());

        job.setStatus(JobStatus.FAILED);
        job.setErrorCode("STAGE_PROCESSING_ERROR");
        job.setErrorMessage(request.getErrorMessage());
        job.setFailedAt(Instant.now());

        jobStageRepository.save(jobStage);
        jobRepository.save(job);

        if (jobStage.getRetryCount() < maxRetry) {
            jobStage.setRetryCount(jobStage.getRetryCount() + 1);
            jobStage.setStatus(JobStageStatus.RETRYING);

            job.setStatus(JobStatus.RETRYING);

            jobStageRepository.save(jobStage);
            jobRepository.save(job);

            jobQueueService.enqueueRetry(job.getId());

        } else {
            job.setStatus(JobStatus.DLQ);
            jobRepository.save(job);
            if (job.getMeetingId() != null) {
                meetingRepository.findById(job.getMeetingId()).ifPresent(meeting -> {
                    meeting.setStatus(MeetingStatus.FAILED);
                    meetingRepository.save(meeting);
                });
            }

            jobQueueService.enqueueDLQ(job.getId());
        }
    }

}
