package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.enums.JobEventType;
import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.model.dto.JobSnapshotDTO;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobStageRepository;
import com.example.smartrec.service.JobProgressService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor

public class JobProgressServiceImpl implements JobProgressService {
    private final JobRepository jobRepository;
    private final JobStageRepository jobStageRepository;
    private final ApplicationEventPublisher eventPublisher;

    @Override
    @Transactional(readOnly = true)
    public JobSnapshotDTO getSnapshot(UUID jobId) {
        Job job = jobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND", "job không tìm thấy"));
        // Lấy danh sách các stage của Job
        List<JobStage> stages = jobStageRepository.findByJobIdOrderByStageAsc(jobId);
        int progress = calculateProgress(job, stages);
        return new JobSnapshotDTO(
                job.getId(),
                job.getMeetingId(),
                job.getStatus().name(),
                job.getCurrentStage() != null
                        ? job.getCurrentStage().name()
                        : null,
                progress,
                job.getEventSequence(),
                job.getUpdatedAt());
    }

    @Override
    @Transactional
    public void publishProgress(UUID jobId) {
        Job job = jobRepository.findByIdForUpdate(jobId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND", "job không tìm thấy"));
        // Lấy danh sách các stage của Job
        List<JobStage> stages = jobStageRepository.findByJobIdOrderByStageAsc(jobId);
        Long currentSequence = job.getEventSequence() == null ? 0L : job.getEventSequence();
        // Tăng sequence lên 1 để đánh số cho event sắp được tạo.
        job.setEventSequence(currentSequence + 1);
        jobRepository.save(job);
        // Capture an immutable snapshot while the Job and its sequence are locked.
        JobProgressEventReponse event = new JobProgressEventReponse(
                resolveEventType(job.getStatus()),
                "1",
                job.getId(),
                job.getMeetingId(),
                UUID.randomUUID(),
                job.getEventSequence(),
                Instant.now(),
                job.getCurrentStage() != null
                        ? job.getCurrentStage().name()
                        : null,
                job.getStatus().name(),
                calculateProgress(job, stages));
        eventPublisher.publishEvent(event);
    }

    private int calculateProgress(Job job, List<JobStage> stages) {

        // Chỉ Job hoàn thành mới có progress = 100
        if (job.getStatus() == JobStatus.COMPLETED) {
            return 100;
        }

        if (stages == null || stages.isEmpty()) {
            return 0;
        }

        long completedStages = stages.stream()
                .filter(stage -> stage.getStatus() == JobStageStatus.SUCCESS)
                .count();

        return (int) Math.round(
                completedStages * 100.0 / stages.size());
    }

    private String resolveEventType(JobStatus status) {

        if (status == JobStatus.COMPLETED) {
            return JobEventType.JOB_COMPLETED.name();
        }

        if (status == JobStatus.FAILED || status == JobStatus.DLQ) {
            return JobEventType.JOB_FAILED.name();
        }

        return JobEventType.JOB_PROGRESS.name();
    }
}
