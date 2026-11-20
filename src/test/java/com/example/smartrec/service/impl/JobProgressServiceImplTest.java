package com.example.smartrec.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.enums.PipelineStage;
import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobStageRepository;

@ExtendWith(MockitoExtension.class)
// Kiểm tra nội dung snapshot/event được dựng từ trạng thái đã lưu của job và các stage.
class JobProgressServiceImplTest {
    @Mock private JobRepository jobRepository;
    @Mock private JobStageRepository jobStageRepository;
    @Mock private ApplicationEventPublisher eventPublisher;
    @InjectMocks private JobProgressServiceImpl service;

    // Event tăng sequence đơn điệu và tính phần trăm theo số stage đã hoàn thành.
    @Test
    void publishingUsesMonotonicJobSequenceAndStageBasedProgress() {
        UUID jobId = UUID.randomUUID();
        Job job = Job.builder()
                .id(jobId)
                .meetingId(UUID.randomUUID())
                .status(JobStatus.PROCESSING)
                .currentStage(PipelineStage.PYANNOTE)
                .eventSequence(8L)
                .updatedAt(Instant.parse("2026-11-18T08:00:00Z"))
                .build();
        when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of(
                JobStage.builder().stage(PipelineStage.FFMPEG).status(JobStageStatus.SUCCESS).build(),
                JobStage.builder().stage(PipelineStage.WEBRTC).status(JobStageStatus.SUCCESS).build(),
                JobStage.builder().stage(PipelineStage.PYANNOTE).status(JobStageStatus.PROCESSING).build(),
                JobStage.builder().stage(PipelineStage.OUTPUT).status(JobStageStatus.PENDING).build()));

        service.publishProgress(jobId);

        assertEquals(9L, job.getEventSequence());
        verify(jobRepository).save(job);
        ArgumentCaptor<Object> eventCaptor = ArgumentCaptor.forClass(Object.class);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        JobProgressEventReponse event = (JobProgressEventReponse) eventCaptor.getValue();
        assertEquals(jobId, event.getJobId());
        assertEquals(job.getMeetingId(), event.getMeetingId());
        assertEquals(9L, event.getSequence());
        assertEquals("PYANNOTE", event.getCurrentStage());
        assertEquals("PROCESSING", event.getStatus());
        assertEquals(50, event.getProgressPercent());
        org.junit.jupiter.api.Assertions.assertNotNull(event.getEventId());
        org.junit.jupiter.api.Assertions.assertNotNull(event.getTimestamp());
    }

    // Snapshot dùng sequence đã lưu; job hoàn tất luôn có progress 100%.
    @Test
    void snapshotUsesPersistedSequenceAndCompletedJobsReportOneHundredPercent() {
        UUID jobId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).meetingId(UUID.randomUUID())
                .status(JobStatus.COMPLETED).eventSequence(12L).build();
        when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of());

        var snapshot = service.getSnapshot(jobId);

        assertEquals(12L, snapshot.getSequence());
        assertEquals(100, snapshot.getProgressPercent());
        assertEquals("COMPLETED", snapshot.getStatus());
    }

    // Trạng thái cuối tạo đúng event type và phần trăm tương ứng.
    @Test
    void terminalEventsReflectCompletedAndFailedLifecycleStatuses() {
        UUID completedId = UUID.randomUUID();
        Job completed = Job.builder().id(completedId).meetingId(UUID.randomUUID())
                .status(JobStatus.COMPLETED).eventSequence(0L).build();
        UUID failedId = UUID.randomUUID();
        Job failed = Job.builder().id(failedId).meetingId(UUID.randomUUID())
                .status(JobStatus.FAILED).eventSequence(2L).build();
        when(jobRepository.findById(completedId)).thenReturn(Optional.of(completed));
        when(jobRepository.findById(failedId)).thenReturn(Optional.of(failed));
        when(jobStageRepository.findByJobIdOrderByStageAsc(completedId)).thenReturn(List.of());
        when(jobStageRepository.findByJobIdOrderByStageAsc(failedId)).thenReturn(List.of());

        service.publishProgress(completedId);
        service.publishProgress(failedId);

        ArgumentCaptor<Object> eventCaptor = ArgumentCaptor.forClass(Object.class);
        verify(eventPublisher, org.mockito.Mockito.times(2)).publishEvent(eventCaptor.capture());
        List<Object> events = eventCaptor.getAllValues();
        JobProgressEventReponse completedEvent = (JobProgressEventReponse) events.get(0);
        JobProgressEventReponse failedEvent = (JobProgressEventReponse) events.get(1);
        assertEquals("JOB_COMPLETED", completedEvent.getEventType());
        assertEquals(100, completedEvent.getProgressPercent());
        assertEquals("COMPLETED", completedEvent.getStatus());
        assertEquals("JOB_FAILED", failedEvent.getEventType());
        assertEquals("FAILED", failedEvent.getStatus());
    }
}
