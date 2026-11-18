package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobDispatchOutbox;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.repository.JobDispatchOutboxRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.service.JobQueueService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/** Claims one durable outbox row and sends it while holding its database lock. */
@Service
@RequiredArgsConstructor
@Slf4j
public class JobDispatchOutboxProcessor {
    private static final Set<JobStatus> DISPATCHABLE_STATUSES =
            Set.of(JobStatus.PENDING, JobStatus.QUEUED, JobStatus.RETRYING);

    private final JobDispatchOutboxRepository outboxRepository;
    private final JobRepository jobRepository;
    private final JobQueueService jobQueueService;

    /** Returns a future retry time, or null when the row is completed/consumed. */
    @Transactional
    public Instant dispatch(UUID outboxId) {
        JobDispatchOutbox record = outboxRepository.findByIdForUpdate(outboxId).orElse(null);
        if (record == null || record.getDispatchedAt() != null) return null;

        Instant now = Instant.now();
        if (record.getAvailableAt().isAfter(now)) return record.getAvailableAt();

        Job job = jobRepository.findByIdForUpdate(record.getJobId()).orElse(null);
        if (job == null || !DISPATCHABLE_STATUSES.contains(job.getStatus()) || ownsLiveExecution(job, now)) {
            record.setDispatchedAt(now);
            outboxRepository.save(record);
            return null;
        }

        try {
            // A 2xx response from the existing AI Engine enqueue endpoint is its acceptance acknowledgement.
            jobQueueService.enqueueJob(job.getId());
            record.setDispatchedAt(Instant.now());
            record.setLastError(null);
            outboxRepository.save(record);
            return null;
        } catch (RuntimeException exception) {
            int attempts = record.getAttemptCount() + 1;
            long retrySeconds = Math.min(60, 1L << Math.min(attempts, 6));
            Instant retryAt = Instant.now().plusSeconds(retrySeconds);
            record.setAttemptCount(attempts);
            record.setAvailableAt(retryAt);
            record.setLastError(safeError(exception));
            outboxRepository.save(record);
            log.warn("Job {} enqueue attempt {} failed; retry scheduled for {}",
                    job.getId(), attempts, retryAt);
            return retryAt;
        }
    }

    private boolean ownsLiveExecution(Job job, Instant now) {
        return job.getExecutionId() != null && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(now);
    }

    private String safeError(RuntimeException exception) {
        String message = exception.getMessage();
        String value = message == null || message.isBlank()
                ? exception.getClass().getSimpleName()
                : message;
        return value.substring(0, Math.min(1000, value.length()));
    }
}
