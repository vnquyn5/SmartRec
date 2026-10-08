package com.example.smartrec.service.impl;

import org.springframework.stereotype.Service;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.entity.JobDispatchOutbox;
import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.enums.PipelineStage;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.CreateJobRequest;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.model.dto.SpeakerSegmentResponse;
import com.example.smartrec.model.dto.WorkerCallbackRequest;
import com.example.smartrec.model.dto.WorkerJobControlResponse;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobDispatchOutboxRepository;
import com.example.smartrec.repository.JobStageRepository;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.JobService;
import com.example.smartrec.service.MeetingService;

import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.Set;
import org.springframework.data.domain.PageRequest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class JobServiceImpl implements JobService {
    private final JobRepository jobRepository;
    private final JobDispatchOutboxRepository outboxRepository;
    private final JobStageRepository jobStageRepository;
    private final MediaFileRepository mediaFileRepository;
    private final SpeakerSegmentRepository speakerSegmentRepository;
    private final MeetingRepository meetingRepository;
    private final MeetingService meetingService;
    @Value("${job.max-retry:5}") // doc cau hinh trong yml
    private int maxRetry;
    @Value("${job.heartbeat-timeout-seconds:90}")
    private long heartbeatTimeoutSeconds;

    @Override
    @Transactional
    public JobResponse createJob(CreateJobRequest request) {

        if (request == null || request.getMediaFileId() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_REQUEST",
                    "mediaFileId không được để trống");
        }

        var existingJob = jobRepository.findFirstByMediaFileIdOrderByCreatedAtDesc(request.getMediaFileId());
        if (existingJob.isPresent()) {
            meetingRepository.findByMediaFileId(request.getMediaFileId()).ifPresent(meeting -> {
                syncMeetingStatus(meeting, existingJob.get());
            });
            return toResponse(existingJob.get());
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
        meeting.setActive_job_id(job.getId());
        meeting.setStatus(MeetingStatus.PROCESSING);
        meetingRepository.save(meeting);

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
        enqueueJob(job.getId());
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
                .lastHeartbeatAt(job.getLastHeartbeatAt())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public JobResponse getJobForCurrentUser(UUID jobId) {
        Job job = findJob(jobId);
        meetingService.getMeeting(job.getMeetingId());
        return getJob(jobId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<JobResponse> getDLQJob() { // chuyen doi 1 doi tuong entity thanh 1 doi tuong response de tra ve cho
                                           // client
        return jobRepository.findByStatus(JobStatus.DLQ).stream().map(this::toResponse).toList();

    }

    @Override
    @Transactional(readOnly = true)
    public List<JobResponse> getDLQJobsForCurrentUser() {
        return jobRepository.findByStatus(JobStatus.DLQ).stream()
                .filter(job -> {
                    try {
                        meetingService.getMeeting(job.getMeetingId());
                        return true;
                    } catch (BusinessException deniedOrMissing) {
                        return false;
                    }
                })
                .map(this::toResponse)
                .toList();
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
        markMeetingProcessing(job);

    }

    @Override
    @Transactional
    public void manualRetry(UUID jobId) {
        Job job = jobRepository.findByIdForUpdate(jobId).orElseGet(() -> findJob(jobId));

        if (Set.of(JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.RUNNING, JobStatus.RETRYING,
                JobStatus.PAUSE_REQUESTED, JobStatus.PAUSED, JobStatus.CANCEL_REQUESTED).contains(job.getStatus())) {
            return;
        }
        if (!Set.of(JobStatus.DLQ, JobStatus.FAILED, JobStatus.CANCELLED).contains(job.getStatus())) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_JOB_STATUS",
                    "Chỉ Job FAILED, DLQ hoặc CANCELLED mới được retry thủ công");
        }
        List<JobStage> stages = jobStageRepository.findByJobIdOrderByStageAsc(jobId);
        JobStage failedStage = stages
                .stream()
                .filter(stage -> stage.getStatus() == JobStageStatus.FAILED)
                .findFirst()
                .orElse(stages.stream().filter(stage -> stage.getStage() == PipelineStage.FFMPEG)
                .findFirst().orElseThrow());

        Meeting meeting = meetingRepository.findById(job.getMeetingId()).orElse(null);
        if (meeting != null && meeting.getActive_job_id() != null && !jobId.equals(meeting.getActive_job_id())) {
            Job activeJob = jobRepository.findById(meeting.getActive_job_id()).orElse(null);
            if (activeJob != null && Set.of(JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING,
                    JobStatus.RUNNING, JobStatus.RETRYING, JobStatus.PAUSE_REQUESTED, JobStatus.PAUSED,
                    JobStatus.CANCEL_REQUESTED).contains(activeJob.getStatus())) {
                throw new BusinessException(HttpStatus.CONFLICT, "ACTIVE_JOB_EXISTS",
                        "Cuộc họp đang có một Job khác chưa kết thúc");
            }
        }

        // Celery restarts the complete processor when a task is retried.
        stages.forEach(stage -> {
            stage.setStatus(JobStageStatus.PENDING);
            stage.setRetryCount(0);
            stage.setStartedAt(null);
            stage.setCompletedAt(null);
            stage.setErrorCode(null);
            stage.setErrorMessage(null);
        });
        jobStageRepository.saveAll(stages);
        job.setCurrentStage(PipelineStage.FFMPEG);
        job.setStatus(JobStatus.RETRYING);
        job.setRetryCount(0);
        job.setLastRetryAt(Instant.now());
        job.setErrorCode(null);
        job.setErrorMessage(null);
        job.setFailedAt(null);
        job.setLastHeartbeatAt(null);
        job.setExecutionId(null);
        job.setLeaseExpiresAt(null);
        job.setCancelRequestedAt(null);
        job.setPauseRequestedAt(null);
        if (meeting != null) {
            meeting.setActive_job_id(job.getId());
            meeting.setStatus(MeetingStatus.PROCESSING);
            meetingRepository.save(meeting);
        }

        jobRepository.save(job);

        enqueueJob(job.getId());

        System.out.println(
                "Manual retry Job: "
                        + job.getId()
                        + " - Stage: "
                        + failedStage.getStage());
    }

    @Override
    @Transactional
    public void manualRetryForCurrentUser(UUID jobId) {
        Job job = findJob(jobId);
        meetingService.getMeeting(job.getMeetingId());
        manualRetry(jobId);
    }

    @Override
    @Transactional
    public void pauseForCurrentUser(UUID jobId) {
        Job job = jobRepository.findByIdForUpdate(jobId).orElseGet(() -> findJob(jobId));
        meetingService.getMeeting(job.getMeetingId());
        if (job.getStatus() == JobStatus.PAUSE_REQUESTED || job.getStatus() == JobStatus.PAUSED) return;
        if (!Set.of(JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.RUNNING, JobStatus.RETRYING)
                .contains(job.getStatus())) {
            throw new BusinessException(HttpStatus.CONFLICT, "INVALID_JOB_STATUS", "Job không thể tạm dừng ở trạng thái hiện tại");
        }
        Instant now = Instant.now();
        job.setPauseRequestedAt(now);
        if (Set.of(JobStatus.PENDING, JobStatus.QUEUED).contains(job.getStatus()) && !hasLiveLease(job, now)) {
            job.setStatus(JobStatus.PAUSED);
            if (job.getExecutionId() == null) job.setExecutionId(UUID.randomUUID());
            job.setLeaseExpiresAt(null);
            jobStageRepository.findByJobIdAndStage(jobId, job.getCurrentStage()).ifPresent(stage -> {
                stage.setStatus(JobStageStatus.PAUSED);
                jobStageRepository.save(stage);
            });
            updateMeetingLifecycle(job, MeetingStatus.PAUSED);
        } else {
            job.setStatus(JobStatus.PAUSE_REQUESTED);
            updateMeetingLifecycle(job, MeetingStatus.PAUSE_REQUESTED);
        }
        jobRepository.save(job);
    }

    @Override
    @Transactional
    public void cancelForCurrentUser(UUID jobId) {
        Job job = jobRepository.findByIdForUpdate(jobId).orElseGet(() -> findJob(jobId));
        meetingService.getMeeting(job.getMeetingId());
        if (job.getStatus() == JobStatus.CANCEL_REQUESTED || job.getStatus() == JobStatus.CANCELLED) return;
        if (!Set.of(JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.RUNNING, JobStatus.RETRYING,
                JobStatus.PAUSE_REQUESTED, JobStatus.PAUSED).contains(job.getStatus())) {
            throw new BusinessException(HttpStatus.CONFLICT, "INVALID_JOB_STATUS", "Job không thể hủy ở trạng thái hiện tại");
        }
        Instant now = Instant.now();
        job.setCancelRequestedAt(now);
        if (job.getStatus() == JobStatus.PAUSED
                || Set.of(JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PAUSE_REQUESTED).contains(job.getStatus())
                        && !hasLiveLease(job, now)) {
            completeCancellation(job, now);
        } else {
            job.setStatus(JobStatus.CANCEL_REQUESTED);
            updateMeetingLifecycle(job, MeetingStatus.CANCEL_REQUESTED);
        }
        jobRepository.save(job);
    }

    @Override
    @Transactional
    public void resumeForCurrentUser(UUID jobId) {
        Job job = jobRepository.findByIdForUpdate(jobId).orElseGet(() -> findJob(jobId));
        meetingService.getMeeting(job.getMeetingId());
        if (Set.of(JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.RUNNING, JobStatus.RETRYING).contains(job.getStatus())) return;
        if (job.getStatus() != JobStatus.PAUSED) {
            throw new BusinessException(HttpStatus.CONFLICT, "INVALID_JOB_STATUS", "Chỉ Job PAUSED mới được tiếp tục");
        }
        if (job.getExecutionId() == null) job.setExecutionId(UUID.randomUUID());
        jobStageRepository.findByJobIdAndStage(jobId, job.getCurrentStage()).ifPresent(stage -> {
            stage.setStatus(JobStageStatus.PENDING);
            stage.setCompletedAt(null);
            stage.setErrorCode(null);
            stage.setErrorMessage(null);
            jobStageRepository.save(stage);
        });
        job.setStatus(JobStatus.QUEUED);
        job.setLastHeartbeatAt(null);
        job.setLeaseExpiresAt(null);
        job.setPauseRequestedAt(null);
        job.setCancelRequestedAt(null);
        jobRepository.save(job);
        updateMeetingLifecycle(job, MeetingStatus.PENDING);
        enqueueJob(jobId);
    }

    @Override
    @Transactional
    public WorkerJobControlResponse workerHeartbeat(UUID jobId, UUID executionId) {
        Job job = jobRepository.findByIdForUpdate(jobId).orElseGet(() -> findJob(jobId));
        if (executionId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "EXECUTION_ID_REQUIRED", "Worker executionId không được để trống");
        }
        Instant now = Instant.now();
        boolean terminal = Set.of(JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.DLQ, JobStatus.CANCELLED,
                JobStatus.PAUSED)
                .contains(job.getStatus());
        if (terminal) return workerControl(job, false);

        boolean sameExecution = executionId.equals(job.getExecutionId());
        boolean liveLease = hasLiveLease(job, now);
        boolean awaitingPauseOrCancel = Set.of(JobStatus.PAUSE_REQUESTED, JobStatus.CANCEL_REQUESTED)
                .contains(job.getStatus());
        // Only the current, still-leased worker may observe and acknowledge a
        // pending stop request. An expired lease must be recovered by watchdog,
        // never claimed by a replacement execution.
        if (awaitingPauseOrCancel && (!sameExecution || !liveLease)) {
            return workerControl(job, false);
        }
        boolean leaseExpired = !liveLease;
        if (!sameExecution && job.getExecutionId() != null && !leaseExpired) {
            return workerControl(job, false);
        }
        job.setExecutionId(executionId);
        job.setLeaseExpiresAt(now.plusSeconds(heartbeatTimeoutSeconds));
        job.setLastHeartbeatAt(now);
        if (Set.of(JobStatus.QUEUED, JobStatus.PENDING, JobStatus.RETRYING).contains(job.getStatus())) {
            job.setStatus(JobStatus.PROCESSING);
            updateMeetingLifecycle(job, MeetingStatus.PROCESSING);
        }
        jobRepository.save(job);
        return workerControl(job, true);
    }

    private WorkerJobControlResponse workerControl(Job job, boolean executionAllowed) {
        String objectKey = mediaFileRepository.findById(job.getMediaFileId()).map(MediaFile::getObject_key).orElse(null);
        List<PipelineStage> successfulStages = jobStageRepository.findByJobIdOrderByStageAsc(job.getId()).stream()
                .filter(stage -> stage.getStatus() == JobStageStatus.SUCCESS).map(JobStage::getStage).toList();
        return WorkerJobControlResponse.builder().jobId(job.getId()).meetingId(job.getMeetingId()).objectKey(objectKey)
                .status(job.getStatus()).currentStage(job.getCurrentStage()).successfulStages(successfulStages)
                .executionAllowed(executionAllowed).build();
    }

    private boolean hasLiveLease(Job job, Instant now) {
        return job.getExecutionId() != null && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(now);
    }

    private void completeCancellation(Job job, Instant now) {
        job.setStatus(JobStatus.CANCELLED);
        job.setExecutionId(null);
        job.setLeaseExpiresAt(null);
        JobStage currentStage = job.getCurrentStage() == null ? null
                : jobStageRepository.findByJobIdAndStage(job.getId(), job.getCurrentStage()).orElse(null);
        if (currentStage != null) {
            currentStage.setStatus(JobStageStatus.CANCELLED);
            currentStage.setCompletedAt(now);
            jobStageRepository.save(currentStage);
            markDownstreamStagesSkipped(job, currentStage);
        }
        updateMeetingLifecycle(job, MeetingStatus.CANCELLED);
    }

    @Override
    @Transactional
    public void markStaleJobsFailed() {
        Instant now = Instant.now();
        Instant cutoff = now.minusSeconds(heartbeatTimeoutSeconds);
        List<JobStatus> monitored = List.of(
                JobStatus.PROCESSING,
                JobStatus.RUNNING,
                JobStatus.RETRYING,
                JobStatus.PAUSE_REQUESTED,
                JobStatus.CANCEL_REQUESTED);
        for (Job candidate : jobRepository.findByStatusInOrderByUpdatedAtAsc(monitored, PageRequest.of(0, 100))) {
            Job job = jobRepository.findByIdForUpdate(candidate.getId()).orElse(null);
            if (job == null || !monitored.contains(job.getStatus()) || !isWorkerLeaseStale(job, cutoff, now)) continue;
            if (job.getStatus() == JobStatus.CANCEL_REQUESTED) {
                completeCancellation(job, now);
                job.setErrorCode("CANCEL_RECOVERED_AFTER_WORKER_LOST");
                job.setErrorMessage("Cancellation was finalized after the execution lease expired.");
            } else if (job.getStatus() == JobStatus.PAUSE_REQUESTED) {
                job.setStatus(JobStatus.PAUSED);
                job.setExecutionId(null);
                job.setLeaseExpiresAt(null);
                if (job.getCurrentStage() != null) {
                    jobStageRepository.findByJobIdAndStage(job.getId(), job.getCurrentStage()).ifPresent(stage -> {
                        stage.setStatus(JobStageStatus.PAUSED);
                        stage.setErrorCode(null);
                        stage.setErrorMessage(null);
                        jobStageRepository.save(stage);
                    });
                }
                updateMeetingLifecycle(job, MeetingStatus.PAUSED);
            } else {
                job.setStatus(JobStatus.FAILED);
                job.setErrorCode("WORKER_LOST");
                job.setErrorMessage("AI worker heartbeat timed out; worker may have stopped unexpectedly.");
                job.setFailedAt(now);
                job.setExecutionId(null);
                job.setLeaseExpiresAt(null);
                if (job.getCurrentStage() != null) {
                    jobStageRepository.findByJobIdAndStage(job.getId(), job.getCurrentStage()).ifPresent(stage -> {
                        stage.setStatus(JobStageStatus.FAILED);
                        stage.setErrorCode("WORKER_LOST");
                        stage.setErrorMessage(job.getErrorMessage());
                        stage.setCompletedAt(now);
                        jobStageRepository.save(stage);
                        markDownstreamStagesSkipped(job, stage);
                    });
                }
                markMeetingFailed(job);
            }
            jobRepository.save(job);
        }
    }

    private boolean isWorkerLeaseStale(Job job, Instant fallbackCutoff, Instant now) {
        if (job.getExecutionId() != null && job.getLeaseExpiresAt() != null) {
            return !job.getLeaseExpiresAt().isAfter(now);
        }
        Instant lastSeen = job.getLastHeartbeatAt() != null ? job.getLastHeartbeatAt()
                : job.getUpdatedAt() != null ? job.getUpdatedAt() : job.getCreatedAt();
        return lastSeen != null && lastSeen.isBefore(fallbackCutoff);
    }

    private void updateMeetingLifecycle(Job job, MeetingStatus status) {
        meetingRepository.findById(job.getMeetingId()).ifPresent(meeting -> {
            meeting.setActive_job_id(job.getId());
            meeting.setStatus(status);
            meetingRepository.save(meeting);
        });
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
        Job job = jobRepository.findByIdForUpdate(jobId).orElseGet(() -> findJob(jobId));
        if (request == null || request.getStage() == null || request.getStatus() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_CALLBACK",
                    "Stage không được để trống");
        }
        if (request.getExecutionId() == null || !request.getExecutionId().equals(job.getExecutionId())) {
            throw new BusinessException(HttpStatus.CONFLICT, "STALE_EXECUTION_CALLBACK",
                    "Callback thiếu execution ID hợp lệ hoặc không thuộc execution hiện tại của Job");
        }
        JobStage jobStage = jobStageRepository.findByJobIdAndStage(jobId, request.getStage())
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "JOB_STAGE_NOT_FOUND",
                        "Không tìm thấy Job Stage"));
        if (isIdempotentCallback(job, jobStage, request)) return;
        if (Set.of(JobStatus.COMPLETED, JobStatus.DLQ, JobStatus.CANCELLED, JobStatus.PAUSED, JobStatus.FAILED)
                .contains(job.getStatus())) {
            throw new BusinessException(HttpStatus.CONFLICT, "TERMINAL_JOB_CALLBACK",
                    "Không nhận callback cho Job đã kết thúc");
        }
        if (!ownsExecution(job, request.getExecutionId())) {
            throw new BusinessException(HttpStatus.CONFLICT, "STALE_EXECUTION_CALLBACK",
                    "Callback không thuộc execution lease hiện tại của Job");
        }
        if (job.getMeetingId() != null) {
            Meeting meeting = meetingRepository.findById(job.getMeetingId()).orElse(null);
            if (meeting != null && meeting.getActive_job_id() != null
                    && !jobId.equals(meeting.getActive_job_id())) {
                throw new BusinessException(HttpStatus.CONFLICT, "STALE_JOB_CALLBACK",
                        "Callback thuộc về Job không còn active của Meeting");
            }
        }
        if (request.getStatus() == JobStageStatus.SUCCESS && job.getStatus() == JobStatus.CANCEL_REQUESTED) {
            Instant now = Instant.now();
            jobStage.setStatus(JobStageStatus.CANCELLED);
            jobStage.setCompletedAt(now);
            job.setStatus(JobStatus.CANCELLED);
            job.setLeaseExpiresAt(null);
            markDownstreamStagesSkipped(job, jobStage);
            updateMeetingLifecycle(job, MeetingStatus.CANCELLED);
            jobStageRepository.save(jobStage);
            jobRepository.save(job);
            return;
        }

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
            if (job.getStatus() != JobStatus.PAUSE_REQUESTED && job.getStatus() != JobStatus.CANCEL_REQUESTED) {
                job.setStatus(JobStatus.PROCESSING);
            }

            jobStage.setStatus(
                    JobStageStatus.PROCESSING);
            if (jobStage.getStartedAt() == null) {
                jobStage.setStartedAt(Instant.now());
            }
            markMeetingProcessing(job);
            if (job.getStatus() == JobStatus.PAUSE_REQUESTED) updateMeetingLifecycle(job, MeetingStatus.PAUSE_REQUESTED);
            if (job.getStatus() == JobStatus.CANCEL_REQUESTED) updateMeetingLifecycle(job, MeetingStatus.CANCEL_REQUESTED);
        } else if (request.getStatus() == JobStageStatus.SUCCESS) {

            jobStage.setStatus(JobStageStatus.SUCCESS);
            jobStage.setCompletedAt(Instant.now());

            if (request.getStage() == PipelineStage.OUTPUT) {
                if (job.getMeetingId() != null) {
                    speakerSegmentRepository.deleteByMeetingId(job.getMeetingId());
                }
                List<SpeakerSegment> segmentsToSave = (request.getSegments() == null ? List.<SpeakerSegmentResponse>of() : request.getSegments()).stream()
                        .filter(seg -> seg != null && seg.getStartTime() != null && seg.getEndTime() != null
                                && seg.getEndTime() > seg.getStartTime() && seg.getStartTime() >= 0)
                        .filter(seg -> seg.getSpeakerLabel() != null && !seg.getSpeakerLabel().isBlank())
                        .map(seg -> SpeakerSegment.builder()
                                .meetingId(job.getMeetingId())
                                .speakerLabel(seg.getSpeakerLabel().trim())
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
        } else if (request.getStatus() == JobStageStatus.PAUSED) {
            if (job.getStatus() != JobStatus.PAUSE_REQUESTED && job.getStatus() != JobStatus.PAUSED) {
                throw new BusinessException(HttpStatus.CONFLICT, "PAUSE_NOT_REQUESTED", "Job chưa có yêu cầu tạm dừng");
            }
            jobStage.setStatus(JobStageStatus.PAUSED);
            job.setStatus(JobStatus.PAUSED);
            job.setLeaseExpiresAt(null);
            updateMeetingLifecycle(job, MeetingStatus.PAUSED);
        } else if (request.getStatus() == JobStageStatus.CANCELLED) {
            if (job.getStatus() != JobStatus.CANCEL_REQUESTED && job.getStatus() != JobStatus.CANCELLED) {
                throw new BusinessException(HttpStatus.CONFLICT, "CANCEL_NOT_REQUESTED", "Job chưa có yêu cầu hủy");
            }
            jobStage.setStatus(JobStageStatus.CANCELLED);
            jobStage.setCompletedAt(Instant.now());
            job.setStatus(JobStatus.CANCELLED);
            job.setLeaseExpiresAt(null);
            markDownstreamStagesSkipped(job, jobStage);
            updateMeetingLifecycle(job, MeetingStatus.CANCELLED);
        }

        jobStageRepository.save(jobStage);

        if (request.getStatus() == JobStageStatus.FAILED || job.getStatus() == JobStatus.COMPLETED) {
            job.setLeaseExpiresAt(null);
        }

        jobRepository.save(job);

    }

    private void enqueueJob(UUID jobId) {
        Instant now = Instant.now();
        outboxRepository.save(JobDispatchOutbox.builder()
                .jobId(jobId)
                .attemptCount(0)
                .availableAt(now)
                .createdAt(now)
                .build());
    }

    private boolean ownsExecution(Job job, UUID executionId) {
        return executionId != null && job.getExecutionId() != null && job.getExecutionId().equals(executionId)
                && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(Instant.now());
    }

    private boolean isIdempotentCallback(Job job, JobStage stage, WorkerCallbackRequest request) {
        if (!request.getExecutionId().equals(job.getExecutionId())) return false;
        return (job.getStatus() == JobStatus.CANCELLED && request.getStatus() == JobStageStatus.CANCELLED
                    && stage.getStatus() == JobStageStatus.CANCELLED)
                || (job.getStatus() == JobStatus.PAUSED && request.getStatus() == JobStageStatus.PAUSED
                    && job.getCurrentStage() == request.getStage() && stage.getStatus() == JobStageStatus.PAUSED)
                || (job.getStatus() == JobStatus.COMPLETED && request.getStage() == PipelineStage.OUTPUT
                    && request.getStatus() == JobStageStatus.SUCCESS && stage.getStatus() == JobStageStatus.SUCCESS)
                || ((job.getStatus() == JobStatus.FAILED || job.getStatus() == JobStatus.DLQ)
                    && request.getStatus() == JobStageStatus.FAILED && stage.getStatus() == JobStageStatus.FAILED)
                || (job.getStatus() == JobStatus.RETRYING && stage.getStatus() == JobStageStatus.RETRYING
                    && request.getStatus() == JobStageStatus.FAILED);
    }

    private void markMeetingProcessing(Job job) {
        if (job.getMeetingId() != null) {
            meetingRepository.findById(job.getMeetingId()).ifPresent(meeting -> {
                meeting.setActive_job_id(job.getId());
                meeting.setStatus(MeetingStatus.PROCESSING);
                meetingRepository.save(meeting);
            });
        }
    }

    private void markMeetingFailed(Job job) {
        if (job.getMeetingId() != null) {
            meetingRepository.findById(job.getMeetingId()).ifPresent(meeting -> {
                meeting.setActive_job_id(job.getId());
                meeting.setStatus(MeetingStatus.FAILED);
                meetingRepository.save(meeting);
            });
        }
    }

    private void syncMeetingStatus(Meeting meeting, Job job) {
        meeting.setActive_job_id(job.getId());
        meeting.setStatus(switch (job.getStatus()) {
            case COMPLETED -> MeetingStatus.COMPLETED;
            case DLQ, FAILED -> MeetingStatus.FAILED;
            case PENDING, QUEUED -> MeetingStatus.PENDING;
            case PROCESSING, RETRYING, RUNNING -> MeetingStatus.PROCESSING;
            case PAUSE_REQUESTED -> MeetingStatus.PAUSE_REQUESTED;
            case PAUSED -> MeetingStatus.PAUSED;
            case CANCEL_REQUESTED -> MeetingStatus.CANCEL_REQUESTED;
            case CANCELLED -> MeetingStatus.CANCELLED;
        });
        meetingRepository.save(meeting);
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
        if (job.getStatus() != JobStatus.PAUSE_REQUESTED && job.getStatus() != JobStatus.CANCEL_REQUESTED) {
            job.setStatus(JobStatus.QUEUED);
        }
        job.setCurrentStage(nextStage);
    }

    private void handleStageFailure(
            Job job,
            JobStage jobStage,
            WorkerCallbackRequest request) {

        String errorCode = request.getErrorCode() == null || request.getErrorCode().isBlank()
                ? "STAGE_PROCESSING_ERROR"
                : request.getErrorCode();
        jobStage.setStatus(JobStageStatus.FAILED);
        jobStage.setErrorCode(errorCode);
        jobStage.setErrorMessage(request.getErrorMessage());

        job.setStatus(JobStatus.FAILED);
        job.setErrorCode(errorCode);
        job.setErrorMessage(request.getErrorMessage());
        job.setFailedAt(Instant.now());

        if (isNonRetryableProcessingError(errorCode)) {
            markDownstreamStagesSkipped(job, jobStage);
            markMeetingFailed(job);
            return;
        }

        jobStageRepository.save(jobStage);
        jobRepository.save(job);

        if (jobStage.getRetryCount() < maxRetry) {
            jobStage.setRetryCount(jobStage.getRetryCount() + 1);
            jobStage.setStatus(JobStageStatus.RETRYING);

            job.setStatus(JobStatus.RETRYING);
            job.setRetryCount((job.getRetryCount() == null ? 0 : job.getRetryCount()) + 1);
            job.setLastRetryAt(Instant.now());

            jobStageRepository.save(jobStage);
            jobRepository.save(job);

        } else {
            job.setStatus(JobStatus.DLQ);
            jobRepository.save(job);
            markMeetingFailed(job);
        }
    }

    private void markDownstreamStagesSkipped(Job job, JobStage failedStage) {
        List<JobStage> stages = jobStageRepository.findByJobIdOrderByStageAsc(job.getId());
        if (stages == null) {
            return;
        }
        for (JobStage stage : stages) {
            if (stage.getStage().ordinal() > failedStage.getStage().ordinal()
                    && stage.getStatus() == JobStageStatus.PENDING) {
                stage.setStatus(JobStageStatus.SKIPPED);
                stage.setErrorCode(failedStage.getErrorCode());
                stage.setErrorMessage("Skipped because stage " + failedStage.getStage() + " failed");
                stage.setCompletedAt(Instant.now());
                jobStageRepository.save(stage);
            }
        }
    }

    private boolean isNonRetryableProcessingError(String errorCode) {
        return switch (errorCode) {
            case "NO_SPEECH_DETECTED", "INVALID_AUDIO", "UNSUPPORTED_FORMAT", "AUDIO_EMPTY",
                    "AUDIO_CORRUPTED", "VALIDATION_ERROR", "WORKSPACE_LOST" -> true;
            default -> false;
        };
    }

}
