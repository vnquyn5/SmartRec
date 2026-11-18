package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.core.task.SyncTaskExecutor;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.event.TransactionalEventListenerFactory;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.hibernate.annotations.ColumnDefault;

import java.util.concurrent.atomic.AtomicReference;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.enums.PipelineStage;
import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobStageRepository;
import com.example.smartrec.service.impl.JobProgressEventListenerImpl;
import com.example.smartrec.service.impl.JobProgressServiceImpl;

class JobProgressServiceImplTest {
    private final JobRepository jobs = mock(JobRepository.class);
    private final JobStageRepository stages = mock(JobStageRepository.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final JobProgressServiceImpl service = new JobProgressServiceImpl(jobs, stages, events);

    @Test
    void incrementsLockedJobSequenceAndPublishesActualPersistedProgress() {
        UUID jobId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).meetingId(UUID.randomUUID()).status(JobStatus.PROCESSING)
                .currentStage(PipelineStage.PYANNOTE).eventSequence(4L).build();
        when(jobs.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(stages.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of(
                stage(PipelineStage.FFMPEG, JobStageStatus.SUCCESS),
                stage(PipelineStage.WEBRTC, JobStageStatus.SUCCESS),
                stage(PipelineStage.PYANNOTE, JobStageStatus.PROCESSING),
                stage(PipelineStage.OUTPUT, JobStageStatus.PENDING)));

        service.publishProgress(jobId);

        assertEquals(5L, job.getEventSequence());
        verify(jobs).save(job);
        ArgumentCaptor<Object> eventCaptor = ArgumentCaptor.forClass(Object.class);
        verify(events).publishEvent(eventCaptor.capture());
        JobProgressEventReponse event = (JobProgressEventReponse) eventCaptor.getValue();
        assertEquals(jobId, event.getJobId());
        assertEquals(5L, event.getSequence());
        assertEquals(50, event.getProgressPercent());
        assertEquals("PYANNOTE", event.getCurrentStage());
        assertEquals("PROCESSING", event.getStatus());
        assertNotNull(event.getTimestamp());
        assertNotNull(event.getEventId());
    }

    @Test
    void publisherRunsAfterCommitAndBrokerFailureDoesNotEscape() throws Exception {
        var handler = JobProgressEventListenerImpl.class
                .getMethod("handleJobProgressEvent", JobProgressEventReponse.class)
                .getAnnotation(TransactionalEventListener.class);
        assertNotNull(handler);
        assertEquals(TransactionPhase.AFTER_COMMIT, handler.phase());

        JobProgressPublisherService publisher = mock(JobProgressPublisherService.class);
        doThrow(new IllegalStateException("broker unavailable"))
                .when(publisher).publish(any(JobProgressEventReponse.class));
        assertDoesNotThrow(() -> new JobProgressEventListenerImpl(new SyncTaskExecutor(), publisher)
                .handleJobProgressEvent(emptyEvent()));
    }

    @Test
    void publisherWorkIsQueuedOutsideListenerAndUsesTheImmutableEventSnapshot() {
        JobProgressPublisherService publisher = mock(JobProgressPublisherService.class);
        TaskExecutor executor = mock(TaskExecutor.class);
        AtomicReference<Runnable> queuedTask = new AtomicReference<>();
        doAnswer(invocation -> {
            queuedTask.set(invocation.getArgument(0));
            return null;
        }).when(executor).execute(any(Runnable.class));
        JobProgressEventReponse event = new JobProgressEventReponse(
                "JOB_PROGRESS", "1", UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                8L, java.time.Instant.now(), "OUTPUT", "PROCESSING", 75);

        new JobProgressEventListenerImpl(executor, publisher).handleJobProgressEvent(event);

        assertNotNull(queuedTask.get());
        verifyNoInteractions(publisher);
        queuedTask.get().run();
        verify(publisher).publish(event);
    }

    @Test
    void executorSaturationDoesNotEscapeAfterDatabaseCommit() {
        TaskExecutor executor = mock(TaskExecutor.class);
        doThrow(new TaskRejectedException("executor full")).when(executor).execute(any(Runnable.class));
        JobProgressPublisherService publisher = mock(JobProgressPublisherService.class);

        assertDoesNotThrow(() -> new JobProgressEventListenerImpl(executor, publisher)
                .handleJobProgressEvent(emptyEvent()));
        verifyNoInteractions(publisher);
    }

    @Test
    void transactionalListenerPublishesOnlyAfterCommit() {
        try (AnnotationConfigApplicationContext context =
                new AnnotationConfigApplicationContext(ProgressListenerTestConfig.class)) {
            JobProgressPublisherService publisher = context.getBean(JobProgressPublisherService.class);
            ApplicationEventPublisher eventPublisher = context;
            TransactionTemplate transaction = new TransactionTemplate(
                    context.getBean(PlatformTransactionManager.class));

            transaction.execute(status -> {
                eventPublisher.publishEvent(emptyEvent());
                verifyNoInteractions(publisher);
                return null;
            });
            verify(publisher).publish(any(JobProgressEventReponse.class));

            reset(publisher);
            transaction.execute(status -> {
                eventPublisher.publishEvent(emptyEvent());
                status.setRollbackOnly();
                return null;
            });
            verifyNoInteractions(publisher);
        }
    }

    @Test
    void entityDeclaresPostgresDefaultAndNonNullSequence() throws Exception {
        var field = Job.class.getDeclaredField("eventSequence");
        assertEquals("0", field.getAnnotation(ColumnDefault.class).value());
        var column = field.getAnnotation(jakarta.persistence.Column.class);
        assertEquals("event_sequence", column.name());
        assertFalse(column.nullable());
        var lock = JobRepository.class.getMethod("findByIdForUpdate", UUID.class)
                .getAnnotation(org.springframework.data.jpa.repository.Lock.class);
        assertEquals(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE, lock.value());
    }

    private JobStage stage(PipelineStage stage, JobStageStatus status) {
        return JobStage.builder().stage(stage).status(status).build();
    }

    @Configuration
    static class ProgressListenerTestConfig {
        @Bean JobProgressPublisherService publisher() {
            return mock(JobProgressPublisherService.class);
        }

        @Bean JobProgressEventListenerImpl listener(JobProgressPublisherService publisher) {
            return new JobProgressEventListenerImpl(new SyncTaskExecutor(), publisher);
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

    private static JobProgressEventReponse emptyEvent() {
        return new JobProgressEventReponse(null, null, null, null, null, null, null, null, null, null);
    }
}
