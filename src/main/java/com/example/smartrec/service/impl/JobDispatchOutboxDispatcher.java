package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobDispatchOutbox;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.repository.JobDispatchOutboxRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.service.JobQueueService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Component
@RequiredArgsConstructor
@Slf4j
public class JobDispatchOutboxDispatcher {
    private final JobDispatchOutboxRepository outboxRepository;
    private final JobRepository jobRepository;
    private final JobQueueService jobQueueService;
    @Value("${job.heartbeat-timeout-seconds:90}")
    private long heartbeatTimeoutSeconds;

    @Scheduled(fixedDelayString = "${job.outbox-scan-interval-ms:2000}")
    @Transactional
    public void dispatchPending() {
        Instant now = Instant.now();
        List<JobDispatchOutbox> pending = outboxRepository
                .findTop100ByDispatchedAtIsNullAndAvailableAtLessThanEqualOrderByCreatedAtAsc(now);
        for (JobDispatchOutbox record : pending) {
            Job job = jobRepository.findById(record.getJobId()).orElse(null);
            if (job == null || !Set.of(JobStatus.PENDING, JobStatus.QUEUED, JobStatus.RETRYING).contains(job.getStatus())) {
                record.setDispatchedAt(now);
                outboxRepository.save(record);
                continue;
            }
            try {
                jobQueueService.enqueueJob(job.getId());
                record.setDispatchedAt(Instant.now());
                record.setLastError(null);
            } catch (RuntimeException exception) {
                int attempts = record.getAttemptCount() + 1;
                record.setAttemptCount(attempts);
                long retrySeconds = Math.min(60, 1L << Math.min(attempts, 6));
                record.setAvailableAt(Instant.now().plusSeconds(retrySeconds));
                record.setLastError(exception.getMessage() == null ? exception.getClass().getSimpleName()
                        : exception.getMessage().substring(0, Math.min(1000, exception.getMessage().length())));
                log.warn("Job {} enqueue attempt {} failed; retry scheduled in {}s",
                        job.getId(), attempts, retrySeconds);
            }
            outboxRepository.save(record);
        }
    }

    @Scheduled(fixedDelayString = "${job.outbox-reconcile-interval-ms:30000}")
    @Transactional
    public void reconcileOrphanedQueuedJobs() {
        Instant now = Instant.now();
        Instant cutoff = now.minusSeconds(heartbeatTimeoutSeconds);
        List<Job> candidates = jobRepository.findByStatusInOrderByUpdatedAtAsc(
                List.of(JobStatus.PENDING, JobStatus.QUEUED), PageRequest.of(0, 100)).getContent();
        for (Job candidate : candidates) {
            Job job = jobRepository.findByIdForUpdate(candidate.getId()).orElse(null);
            if (job == null || !Set.of(JobStatus.PENDING, JobStatus.QUEUED).contains(job.getStatus())) continue;
            if (job.getExecutionId() != null && job.getLeaseExpiresAt() != null
                    && job.getLeaseExpiresAt().isAfter(now)) continue;
            Instant lastActivity = job.getLastHeartbeatAt() != null ? job.getLastHeartbeatAt()
                    : job.getUpdatedAt() != null ? job.getUpdatedAt() : job.getCreatedAt();
            if (lastActivity == null || !lastActivity.isBefore(cutoff)
                    || outboxRepository.existsByJobIdAndDispatchedAtIsNull(job.getId())) continue;
            Instant lastDispatch = outboxRepository.findTopByJobIdOrderByCreatedAtDesc(job.getId())
                    .map(JobDispatchOutbox::getDispatchedAt).orElse(null);
            if (lastDispatch != null && lastDispatch.isAfter(cutoff)) continue;
            outboxRepository.save(JobDispatchOutbox.builder()
                    .id(UUID.randomUUID())
                    .jobId(job.getId())
                    .availableAt(now)
                    .createdAt(now)
                    .build());
            job.setUpdatedAt(now);
            jobRepository.save(job);
            log.warn("Re-enqueued orphaned queued Job {} after dispatch/claim timeout", job.getId());
        }
    }
}
