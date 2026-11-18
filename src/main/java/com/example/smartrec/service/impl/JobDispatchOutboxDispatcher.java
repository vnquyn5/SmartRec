package com.example.smartrec.service.impl;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.task.TaskExecutor;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.context.ApplicationEventPublisher;

import com.example.smartrec.config.JobDispatchRetryScheduler;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobDispatchOutbox;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.model.event.JobDispatchRequestedEvent;
import com.example.smartrec.repository.JobDispatchOutboxRepository;
import com.example.smartrec.repository.JobRepository;

import lombok.extern.slf4j.Slf4j;

@Component
@Slf4j
public class JobDispatchOutboxDispatcher {
    private static final int MAX_SCHEDULED_RETRIES = 10_000;
    private static final long EXECUTOR_REJECTION_RETRY_SECONDS = 5;

    private final JobDispatchOutboxRepository outboxRepository;
    private final JobRepository jobRepository;
    private final JobDispatchOutboxProcessor processor;
    private final ApplicationEventPublisher eventPublisher;
    private final TaskExecutor dispatchExecutor;
    private final JobDispatchRetryScheduler retryScheduler;
    private final long heartbeatTimeoutSeconds;
    private final Set<UUID> inFlight = ConcurrentHashMap.newKeySet();
    private final Set<UUID> scheduledRetries = ConcurrentHashMap.newKeySet();

    public JobDispatchOutboxDispatcher(
            JobDispatchOutboxRepository outboxRepository,
            JobRepository jobRepository,
            JobDispatchOutboxProcessor processor,
            ApplicationEventPublisher eventPublisher,
            @Qualifier("jobDispatchTaskExecutor") TaskExecutor dispatchExecutor,
            @Qualifier("jobDispatchRetryScheduler") JobDispatchRetryScheduler retryScheduler,
            @Value("${job.heartbeat-timeout-seconds:90}") long heartbeatTimeoutSeconds) {
        this.outboxRepository = outboxRepository;
        this.jobRepository = jobRepository;
        this.processor = processor;
        this.eventPublisher = eventPublisher;
        this.dispatchExecutor = dispatchExecutor;
        this.retryScheduler = retryScheduler;
        this.heartbeatTimeoutSeconds = heartbeatTimeoutSeconds;
    }

    /** Enqueue work only after the Job and its Outbox row have committed. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onDispatchRequested(JobDispatchRequestedEvent event) {
        if (event != null && event.outboxId() != null) submit(event.outboxId());
    }

    /** Recover due durable rows immediately after restart. */
    @EventListener(ApplicationReadyEvent.class)
    public void recoverAfterRestart() {
        Instant now = Instant.now();
        List<JobDispatchOutbox> pending = outboxRepository
                .findTop100ByDispatchedAtIsNullOrderByAvailableAtAscCreatedAtAsc();
        for (JobDispatchOutbox record : pending) {
            if (record.getAvailableAt().isAfter(now)) scheduleRetry(record.getId(), record.getAvailableAt());
            else submit(record.getId());
        }
    }

    /** Sparse fallback for rows whose in-memory event/retry task was lost. */
    @Scheduled(fixedDelayString = "${job.outbox-recovery-interval-ms:60000}")
    public void recoverDueOutboxRows() {
        Instant now = Instant.now();
        List<JobDispatchOutbox> due = outboxRepository
                .findTop100ByDispatchedAtIsNullAndAvailableAtLessThanEqualOrderByAvailableAtAscCreatedAtAsc(now);
        for (JobDispatchOutbox record : due) submit(record.getId());
    }

    private void submit(UUID outboxId) {
        if (!inFlight.add(outboxId)) return;
        try {
            dispatchExecutor.execute(() -> {
                try {
                    Instant retryAt = processor.dispatch(outboxId);
                    if (retryAt != null) scheduleRetry(outboxId, retryAt);
                } catch (RuntimeException exception) {
                    log.warn("Outbox {} dispatch transaction failed; scheduling recovery retry", outboxId, exception);
                    scheduleRetry(outboxId, Instant.now().plusSeconds(EXECUTOR_REJECTION_RETRY_SECONDS));
                } finally {
                    inFlight.remove(outboxId);
                }
            });
        } catch (RuntimeException exception) {
            inFlight.remove(outboxId);
            log.warn("Dispatch executor rejected Outbox {}; scheduled retry", outboxId, exception);
            scheduleRetry(outboxId, Instant.now().plusSeconds(EXECUTOR_REJECTION_RETRY_SECONDS));
        }
    }

    private void scheduleRetry(UUID outboxId, Instant retryAt) {
        if (scheduledRetries.contains(outboxId)) return;
        if (scheduledRetries.size() >= MAX_SCHEDULED_RETRIES) {
            log.warn("In-memory dispatch retry capacity is full; Outbox {} will be picked up by recovery", outboxId);
            return;
        }
        if (!scheduledRetries.add(outboxId)) return;
        long delayMillis = Math.max(1, Duration.between(Instant.now(), retryAt).toMillis());
        try {
            retryScheduler.schedule(() -> {
                scheduledRetries.remove(outboxId);
                submit(outboxId);
            }, delayMillis, TimeUnit.MILLISECONDS);
        } catch (RejectedExecutionException exception) {
            scheduledRetries.remove(outboxId);
            log.warn("Retry scheduler rejected Outbox {}; sparse recovery will retry it", outboxId, exception);
        }
    }

    /** Recovery for Jobs whose dispatch record was lost or already consumed incorrectly. */
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
            JobDispatchOutbox record = outboxRepository.save(JobDispatchOutbox.builder()
                    .id(UUID.randomUUID())
                    .jobId(job.getId())
                    .availableAt(now)
                    .createdAt(now)
                    .build());
            job.setUpdatedAt(now);
            jobRepository.save(job);
            eventPublisher.publishEvent(new JobDispatchRequestedEvent(record.getId()));
            log.warn("Re-enqueued orphaned queued Job {} after dispatch/claim timeout", job.getId());
        }
    }
}
