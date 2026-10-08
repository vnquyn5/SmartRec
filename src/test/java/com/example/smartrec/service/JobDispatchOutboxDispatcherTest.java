package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.client.ResourceAccessException;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobDispatchOutbox;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.repository.JobDispatchOutboxRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.service.impl.JobDispatchOutboxDispatcher;

class JobDispatchOutboxDispatcherTest {
    private final JobDispatchOutboxRepository outboxRepository = org.mockito.Mockito.mock(JobDispatchOutboxRepository.class);
    private final JobRepository jobRepository = org.mockito.Mockito.mock(JobRepository.class);
    private final JobQueueService jobQueueService = org.mockito.Mockito.mock(JobQueueService.class);
    private final JobDispatchOutboxDispatcher dispatcher = new JobDispatchOutboxDispatcher(
            outboxRepository, jobRepository, jobQueueService);

    @Test
    void enqueueFailureRemainsDurableAndSchedulesAnotherAttempt() {
        UUID jobId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).status(JobStatus.QUEUED).build();
        JobDispatchOutbox event = JobDispatchOutbox.builder().jobId(jobId).availableAt(Instant.now())
                .createdAt(Instant.now()).build();
        when(outboxRepository.findTop100ByDispatchedAtIsNullAndAvailableAtLessThanEqualOrderByCreatedAtAsc(any()))
                .thenReturn(List.of(event));
        when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        doThrow(new ResourceAccessException("AI Engine unavailable")).when(jobQueueService).enqueueJob(jobId);

        dispatcher.dispatchPending();

        assertEquals(1, event.getAttemptCount());
        assertNotNull(event.getLastError());
        org.junit.jupiter.api.Assertions.assertTrue(event.getAvailableAt().isAfter(Instant.now()));
        verify(outboxRepository).save(event);
    }

    @Test
    void orphanedQueuedJobGetsAReconciliationOutboxRecord() {
        UUID jobId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).status(JobStatus.QUEUED)
                .createdAt(Instant.now().minusSeconds(300)).updatedAt(Instant.now().minusSeconds(300)).build();
        when(jobRepository.findByStatusInOrderByUpdatedAtAsc(List.of(JobStatus.PENDING, JobStatus.QUEUED),
                PageRequest.of(0, 100))).thenReturn(new PageImpl<>(List.of(job)));
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(outboxRepository.existsByJobIdAndDispatchedAtIsNull(jobId)).thenReturn(false);
        when(outboxRepository.findTopByJobIdOrderByCreatedAtDesc(jobId)).thenReturn(Optional.empty());

        dispatcher.reconcileOrphanedQueuedJobs();

        verify(outboxRepository).save(any(JobDispatchOutbox.class));
        verify(jobRepository).save(job);
    }
}
