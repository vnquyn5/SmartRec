package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.SyncTaskExecutor;
import org.springframework.core.task.TaskExecutor;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.event.TransactionalEventListenerFactory;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobDispatchOutbox;
import com.example.smartrec.config.JobDispatchRetryScheduler;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.model.event.JobDispatchRequestedEvent;
import com.example.smartrec.repository.JobDispatchOutboxRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.service.impl.JobDispatchOutboxDispatcher;
import com.example.smartrec.service.impl.JobDispatchOutboxProcessor;

class JobDispatchOutboxDispatcherTest {
    private final JobDispatchOutboxRepository outboxRepository = org.mockito.Mockito.mock(JobDispatchOutboxRepository.class);
    private final JobRepository jobRepository = org.mockito.Mockito.mock(JobRepository.class);
    private final JobDispatchOutboxProcessor processor = org.mockito.Mockito.mock(JobDispatchOutboxProcessor.class);
    private final ApplicationEventPublisher eventPublisher = org.mockito.Mockito.mock(ApplicationEventPublisher.class);
    private final TaskExecutor executor = org.mockito.Mockito.mock(TaskExecutor.class);
    private final JobDispatchRetryScheduler retryScheduler = org.mockito.Mockito.mock(JobDispatchRetryScheduler.class);
    private final JobDispatchOutboxDispatcher dispatcher = new JobDispatchOutboxDispatcher(
            outboxRepository, jobRepository, processor, eventPublisher, executor, retryScheduler, 90);

    @Test
    void transactionCommitDispatchesAfterCommitAndRollbackDispatchesNothing() {
        try (AnnotationConfigApplicationContext context =
                new AnnotationConfigApplicationContext(DispatchListenerTestConfig.class)) {
            JobDispatchOutboxProcessor transactionalProcessor = context.getBean(JobDispatchOutboxProcessor.class);
            ApplicationEventPublisher eventPublisher = context;
            TransactionTemplate transaction = new TransactionTemplate(
                    context.getBean(PlatformTransactionManager.class));
            UUID outboxId = UUID.randomUUID();

            transaction.execute(status -> {
                eventPublisher.publishEvent(new JobDispatchRequestedEvent(outboxId));
                verifyNoInteractions(transactionalProcessor);
                return null;
            });
            verify(transactionalProcessor).dispatch(outboxId);

            reset(transactionalProcessor);
            transaction.execute(status -> {
                eventPublisher.publishEvent(new JobDispatchRequestedEvent(outboxId));
                status.setRollbackOnly();
                return null;
            });
            verifyNoInteractions(transactionalProcessor);
        }
    }

    @Test
    void duplicateEventsQueueOnlyOneTaskWhileTheRecordIsInFlight() {
        UUID outboxId = UUID.randomUUID();
        AtomicReference<Runnable> queuedTask = new AtomicReference<>();
        doAnswer(invocation -> {
            queuedTask.set(invocation.getArgument(0));
            return null;
        }).when(executor).execute(any(Runnable.class));

        dispatcher.onDispatchRequested(new JobDispatchRequestedEvent(outboxId));
        dispatcher.onDispatchRequested(new JobDispatchRequestedEvent(outboxId));

        verify(executor).execute(any(Runnable.class));
        assertNotNull(queuedTask.get());
        verifyNoInteractions(processor);
        queuedTask.get().run();
        verify(processor).dispatch(outboxId);
    }

    @Test
    void retryIsScheduledAtThePersistedAvailableAtTime() {
        UUID outboxId = UUID.randomUUID();
        Instant retryAt = Instant.now().plusSeconds(20);
        AtomicReference<Runnable> queuedTask = new AtomicReference<>();
        doAnswer(invocation -> {
            queuedTask.set(invocation.getArgument(0));
            return null;
        }).when(executor).execute(any(Runnable.class));
        when(processor.dispatch(outboxId)).thenReturn(retryAt);

        dispatcher.onDispatchRequested(new JobDispatchRequestedEvent(outboxId));
        queuedTask.get().run();

        ArgumentCaptor<Runnable> retry = ArgumentCaptor.forClass(Runnable.class);
        ArgumentCaptor<Long> delay = ArgumentCaptor.forClass(Long.class);
        verify(retryScheduler).schedule(retry.capture(), delay.capture(), org.mockito.ArgumentMatchers.eq(TimeUnit.MILLISECONDS));
        assertTrue(delay.getValue() > 18_000 && delay.getValue() <= 20_000);
        assertNotNull(retry.getValue());
    }

    @Test
    void restartRecoverySubmitsOnlyDuePendingRows() {
        UUID outboxId = UUID.randomUUID();
        JobDispatchOutbox outbox = JobDispatchOutbox.builder().id(outboxId).jobId(UUID.randomUUID())
                .availableAt(Instant.now().minusSeconds(1)).createdAt(Instant.now()).build();
        when(outboxRepository.findTop100ByDispatchedAtIsNullOrderByAvailableAtAscCreatedAtAsc())
                .thenReturn(List.of(outbox));

        dispatcher.recoverAfterRestart();

        verify(outboxRepository).findTop100ByDispatchedAtIsNullOrderByAvailableAtAscCreatedAtAsc();
        verify(executor).execute(any(Runnable.class));
    }

    @Test
    void sparseFallbackQueriesOnlyRowsWhoseAvailableAtHasArrived() {
        when(outboxRepository
                .findTop100ByDispatchedAtIsNullAndAvailableAtLessThanEqualOrderByAvailableAtAscCreatedAtAsc(any()))
                .thenReturn(List.of());

        dispatcher.recoverDueOutboxRows();

        verify(outboxRepository)
                .findTop100ByDispatchedAtIsNullAndAvailableAtLessThanEqualOrderByAvailableAtAscCreatedAtAsc(any());
        verify(executor, never()).execute(any(Runnable.class));
    }

    @Test
    void idleRecoveryIsSparseAndDispatchHasNoPollingSchedule() throws Exception {
        var recovery = JobDispatchOutboxDispatcher.class.getMethod("recoverDueOutboxRows")
                .getAnnotation(Scheduled.class);
        assertNotNull(recovery);
        assertEquals("${job.outbox-recovery-interval-ms:60000}", recovery.fixedDelayString());
        var reconciliation = JobDispatchOutboxDispatcher.class.getMethod("reconcileOrphanedQueuedJobs")
                .getAnnotation(Scheduled.class);
        assertEquals("${job.outbox-reconcile-interval-ms:30000}", reconciliation.fixedDelayString());
        assertEquals(0, java.util.Arrays.stream(JobDispatchOutboxDispatcher.class.getDeclaredMethods())
                .filter(method -> method.getName().toLowerCase().contains("dispatch"))
                .filter(method -> method.isAnnotationPresent(Scheduled.class))
                .count());
        assertFalse(JobDispatchOutboxDispatcher.class.getMethod("onDispatchRequested", JobDispatchRequestedEvent.class)
                .getAnnotation(TransactionalEventListener.class).fallbackExecution());
    }

    @Test
    void orphanedQueuedJobGetsOutboxAndPublishesAfterTransaction() {
        UUID jobId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).status(JobStatus.QUEUED)
                .createdAt(Instant.now().minusSeconds(300)).updatedAt(Instant.now().minusSeconds(300)).build();
        when(jobRepository.findByStatusInOrderByUpdatedAtAsc(List.of(JobStatus.PENDING, JobStatus.QUEUED),
                PageRequest.of(0, 100))).thenReturn(new PageImpl<>(List.of(job)));
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(outboxRepository.existsByJobIdAndDispatchedAtIsNull(jobId)).thenReturn(false);
        when(outboxRepository.findTopByJobIdOrderByCreatedAtDesc(jobId)).thenReturn(Optional.empty());
        when(outboxRepository.save(any(JobDispatchOutbox.class))).thenAnswer(invocation -> invocation.getArgument(0));

        dispatcher.reconcileOrphanedQueuedJobs();

        ArgumentCaptor<JobDispatchOutbox> outbox = ArgumentCaptor.forClass(JobDispatchOutbox.class);
        verify(outboxRepository).save(outbox.capture());
        ArgumentCaptor<Object> event = ArgumentCaptor.forClass(Object.class);
        verify(eventPublisher).publishEvent(event.capture());
        assertEquals(outbox.getValue().getId(), ((JobDispatchRequestedEvent) event.getValue()).outboxId());
    }

    @Configuration
    static class DispatchListenerTestConfig {
        @Bean JobDispatchOutboxRepository outboxRepository() {
            return org.mockito.Mockito.mock(JobDispatchOutboxRepository.class);
        }

        @Bean JobRepository jobRepository() {
            return org.mockito.Mockito.mock(JobRepository.class);
        }

        @Bean JobDispatchOutboxProcessor processor() {
            return org.mockito.Mockito.mock(JobDispatchOutboxProcessor.class);
        }

        @Bean TaskExecutor jobDispatchTaskExecutor() {
            return new SyncTaskExecutor();
        }

        @Bean JobDispatchRetryScheduler jobDispatchRetryScheduler() {
            return new JobDispatchRetryScheduler();
        }

        @Bean JobDispatchOutboxDispatcher dispatcher(
                JobDispatchOutboxRepository outboxRepository,
                JobRepository jobRepository,
                JobDispatchOutboxProcessor processor,
                ApplicationEventPublisher eventPublisher,
                TaskExecutor jobDispatchTaskExecutor,
                JobDispatchRetryScheduler jobDispatchRetryScheduler) {
            return new JobDispatchOutboxDispatcher(outboxRepository, jobRepository, processor, eventPublisher,
                    jobDispatchTaskExecutor, jobDispatchRetryScheduler, 90);
        }

        @Bean TransactionalEventListenerFactory transactionalEventListenerFactory() {
            return new TransactionalEventListenerFactory();
        }

        @Bean PlatformTransactionManager transactionManager() {
            return new AbstractPlatformTransactionManager() {
                @Override protected Object doGetTransaction() { return new Object(); }
                @Override protected void doBegin(Object transaction, TransactionDefinition definition) {}
                @Override protected void doCommit(DefaultTransactionStatus status) {}
                @Override protected void doRollback(DefaultTransactionStatus status) {}
                @Override protected void doSetRollbackOnly(DefaultTransactionStatus status) {}
            };
        }
    }
}
