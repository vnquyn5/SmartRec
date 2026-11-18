package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.ResourceAccessException;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobDispatchOutbox;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.repository.JobDispatchOutboxRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.service.impl.JobDispatchOutboxProcessor;

class JobDispatchOutboxProcessorTest {
    private final JobDispatchOutboxRepository outboxRepository = org.mockito.Mockito.mock(JobDispatchOutboxRepository.class);
    private final JobRepository jobRepository = org.mockito.Mockito.mock(JobRepository.class);
    private final JobQueueService jobQueueService = org.mockito.Mockito.mock(JobQueueService.class);
    private final JobDispatchOutboxProcessor processor = new JobDispatchOutboxProcessor(
            outboxRepository, jobRepository, jobQueueService);

    @Test
    void dispatchesDueQueuedJobAndMarksOutboxOnlyAfterEngineAccepts() {
        UUID outboxId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        JobDispatchOutbox outbox = outbox(outboxId, jobId, Instant.now().minusSeconds(1));
        Job job = Job.builder().id(jobId).status(JobStatus.QUEUED).build();
        when(outboxRepository.findByIdForUpdate(outboxId)).thenReturn(Optional.of(outbox));
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));

        assertNull(processor.dispatch(outboxId));

        verify(jobQueueService).enqueueJob(jobId);
        assertNotNull(outbox.getDispatchedAt());
        assertNull(outbox.getLastError());
        verify(outboxRepository).save(outbox);
    }

    @Test
    void engineFailureKeepsOutboxAndSchedulesBackoffFromAvailableAt() {
        UUID outboxId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        JobDispatchOutbox outbox = outbox(outboxId, jobId, Instant.now().minusSeconds(1));
        Job job = Job.builder().id(jobId).status(JobStatus.RETRYING).build();
        when(outboxRepository.findByIdForUpdate(outboxId)).thenReturn(Optional.of(outbox));
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        doThrow(new ResourceAccessException("AI Engine unavailable"))
                .when(jobQueueService).enqueueJob(jobId);

        Instant retryAt = processor.dispatch(outboxId);

        assertEquals(1, outbox.getAttemptCount());
        assertNotNull(outbox.getLastError());
        assertNull(outbox.getDispatchedAt());
        assertEquals(outbox.getAvailableAt(), retryAt);
        assertTrue(retryAt.isAfter(Instant.now()));
        verify(outboxRepository).save(outbox);
    }

    @Test
    void futureAvailableAtDefersWithoutReadingJobOrCallingEngine() {
        UUID outboxId = UUID.randomUUID();
        Instant availableAt = Instant.now().plusSeconds(30);
        JobDispatchOutbox outbox = outbox(outboxId, UUID.randomUUID(), availableAt);
        when(outboxRepository.findByIdForUpdate(outboxId)).thenReturn(Optional.of(outbox));

        assertEquals(availableAt, processor.dispatch(outboxId));

        verify(jobRepository, never()).findByIdForUpdate(any());
        verify(jobQueueService, never()).enqueueJob(any());
    }

    @Test
    void terminalOrAlreadyOwnedJobDoesNotEnqueueAgain() {
        UUID terminalOutboxId = UUID.randomUUID();
        UUID leasedOutboxId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        JobDispatchOutbox terminalOutbox = outbox(terminalOutboxId, jobId, Instant.now().minusSeconds(1));
        JobDispatchOutbox leasedOutbox = outbox(leasedOutboxId, jobId, Instant.now().minusSeconds(1));
        Job completed = Job.builder().id(jobId).status(JobStatus.COMPLETED).build();
        Job leased = Job.builder().id(jobId).status(JobStatus.QUEUED).executionId(UUID.randomUUID())
                .leaseExpiresAt(Instant.now().plusSeconds(30)).build();
        when(outboxRepository.findByIdForUpdate(terminalOutboxId)).thenReturn(Optional.of(terminalOutbox));
        when(outboxRepository.findByIdForUpdate(leasedOutboxId)).thenReturn(Optional.of(leasedOutbox));
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(completed), Optional.of(leased));

        assertNull(processor.dispatch(terminalOutboxId));
        assertNull(processor.dispatch(leasedOutboxId));

        assertNotNull(terminalOutbox.getDispatchedAt());
        assertNotNull(leasedOutbox.getDispatchedAt());
        verify(jobQueueService, never()).enqueueJob(any());
    }

    @Test
    void dispatcherUsesPessimisticWriteForCrossInstanceClaim() throws Exception {
        var method = JobDispatchOutboxRepository.class.getMethod("findByIdForUpdate", UUID.class);
        var lock = method.getAnnotation(org.springframework.data.jpa.repository.Lock.class);
        assertNotNull(lock);
        assertEquals(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE, lock.value());
        assertFalse(JobDispatchOutboxRepository.class.getMethod("findTopByJobIdOrderByCreatedAtDesc", UUID.class)
                .isAnnotationPresent(org.springframework.data.jpa.repository.Lock.class));
    }

    private JobDispatchOutbox outbox(UUID id, UUID jobId, Instant availableAt) {
        return JobDispatchOutbox.builder().id(id).jobId(jobId).availableAt(availableAt)
                .createdAt(Instant.now()).build();
    }
}
