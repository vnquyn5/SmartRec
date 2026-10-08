package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.entity.JobDispatchOutbox;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.enums.PipelineStage;
import com.example.smartrec.model.dto.WorkerCallbackRequest;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobDispatchOutboxRepository;
import com.example.smartrec.repository.JobStageRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.impl.JobServiceImpl;

@ExtendWith(MockitoExtension.class)
class JobLifecycleTest {
    @Mock private JobRepository jobRepository;
    @Mock private JobStageRepository jobStageRepository;
    @Mock private JobDispatchOutboxRepository outboxRepository;
    @Mock private MediaFileRepository mediaFileRepository;
    @Mock private SpeakerSegmentRepository speakerSegmentRepository;
    @Mock private MeetingRepository meetingRepository;
    @Mock private MeetingService meetingService;
    @InjectMocks private JobServiceImpl service;

    private UUID jobId;
    private UUID meetingId;
    private Job job;
    private Meeting meeting;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(service, "heartbeatTimeoutSeconds", 60L);
        jobId = UUID.randomUUID();
        meetingId = UUID.randomUUID();
        job = Job.builder().id(jobId).meetingId(meetingId).mediaFileId(UUID.randomUUID())
                .currentStage(PipelineStage.FFMPEG).status(JobStatus.PROCESSING).updatedAt(Instant.now()).build();
        meeting = Meeting.builder().id(meetingId).build();
        org.mockito.Mockito.lenient().when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        org.mockito.Mockito.lenient().when(meetingRepository.findById(meetingId)).thenReturn(Optional.of(meeting));
    }

    @Test
    void pauseRequestIsIdempotent() {
        service.pauseForCurrentUser(jobId);
        assertEquals(JobStatus.PAUSE_REQUESTED, job.getStatus());
        assertEquals(com.example.smartrec.entity.MeetingStatus.PAUSE_REQUESTED, meeting.getStatus());
        service.pauseForCurrentUser(jobId);
        verify(outboxRepository, never()).save(any(JobDispatchOutbox.class));
    }

    @Test
    void heartbeatRefreshesLeaseWithoutChangingActiveState() {
        Instant old = Instant.now().minusSeconds(120);
        job.setLastHeartbeatAt(old);
        when(mediaFileRepository.findById(job.getMediaFileId())).thenReturn(Optional.empty());
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of());

        var response = service.workerHeartbeat(jobId, UUID.randomUUID());

        assertEquals(JobStatus.PROCESSING, response.getStatus());
        org.junit.jupiter.api.Assertions.assertTrue(response.isExecutionAllowed());
        org.junit.jupiter.api.Assertions.assertTrue(job.getLastHeartbeatAt().isAfter(old));
    }

    @Test
    void resumeEnqueuesOnlyOnceWhenRepeated() {
        job.setStatus(JobStatus.PAUSED);
        JobStage stage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PAUSED).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG)).thenReturn(Optional.of(stage));

        service.resumeForCurrentUser(jobId);
        service.resumeForCurrentUser(jobId);

        assertEquals(JobStatus.QUEUED, job.getStatus());
        assertEquals(JobStageStatus.PENDING, stage.getStatus());
        verify(outboxRepository).save(any(JobDispatchOutbox.class));
    }

    @Test
    void cancelRequestIsIdempotent() {
        service.cancelForCurrentUser(jobId);
        service.cancelForCurrentUser(jobId);

        assertEquals(JobStatus.CANCEL_REQUESTED, job.getStatus());
        assertEquals(com.example.smartrec.entity.MeetingStatus.CANCEL_REQUESTED, meeting.getStatus());
        verify(outboxRepository, never()).save(any(JobDispatchOutbox.class));
    }

    @Test
    void cancelQueuedUnclaimedJobCompletesWithoutReenqueuingIt() {
        job.setStatus(JobStatus.QUEUED);
        JobStage ffmpeg = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PENDING).build();
        JobStage output = JobStage.builder().jobId(jobId).stage(PipelineStage.OUTPUT)
                .status(JobStageStatus.PENDING).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG)).thenReturn(Optional.of(ffmpeg));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of(ffmpeg, output));

        service.cancelForCurrentUser(jobId);

        assertEquals(JobStatus.CANCELLED, job.getStatus());
        assertEquals(JobStageStatus.CANCELLED, ffmpeg.getStatus());
        assertEquals(JobStageStatus.SKIPPED, output.getStatus());
        assertEquals(MeetingStatus.CANCELLED, meeting.getStatus());
        verify(outboxRepository, never()).save(any(JobDispatchOutbox.class));
    }

    @Test
    void staleProcessingJobAndCurrentStageAreMarkedFailed() {
        job.setLastHeartbeatAt(Instant.now().minusSeconds(180));
        JobStage stage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();
        when(jobRepository.findByStatusInOrderByUpdatedAtAsc(List.of(JobStatus.PROCESSING, JobStatus.RUNNING,
                JobStatus.RETRYING, JobStatus.PAUSE_REQUESTED, JobStatus.CANCEL_REQUESTED), PageRequest.of(0, 100)))
                .thenReturn(new PageImpl<>(List.of(job)));
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG)).thenReturn(Optional.of(stage));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of(stage));

        service.markStaleJobsFailed();

        assertEquals(JobStatus.FAILED, job.getStatus());
        assertEquals("WORKER_LOST", job.getErrorCode());
        assertEquals(JobStageStatus.FAILED, stage.getStatus());
        assertEquals(com.example.smartrec.entity.MeetingStatus.FAILED, meeting.getStatus());
    }

    @Test
    void pausedWorkerCallbackMovesJobAndMeetingToPaused() {
        job.setStatus(JobStatus.PAUSE_REQUESTED);
        UUID executionId = UUID.randomUUID();
        job.setExecutionId(executionId);
        job.setLeaseExpiresAt(Instant.now().plusSeconds(30));
        JobStage stage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG)).thenReturn(Optional.of(stage));

        service.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .executionId(executionId)
                .stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PAUSED)
                .build());

        assertEquals(JobStatus.PAUSED, job.getStatus());
        assertEquals(JobStageStatus.PAUSED, stage.getStatus());
        assertEquals(MeetingStatus.PAUSED, meeting.getStatus());
    }

    @Test
    void competingWorkerCannotClaimAnUnexpiredExecutionLease() {
        UUID ownerExecutionId = UUID.randomUUID();
        job.setExecutionId(ownerExecutionId);
        job.setLeaseExpiresAt(Instant.now().plusSeconds(60));
        when(mediaFileRepository.findById(job.getMediaFileId())).thenReturn(Optional.empty());
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of());

        var control = service.workerHeartbeat(jobId, UUID.randomUUID());

        assertFalse(control.isExecutionAllowed());
        assertEquals(ownerExecutionId, job.getExecutionId());
    }

    @Test
    void callbackWithoutExecutionIdIsRejectedBeforeStageLookupOrMutation() {
        JobStage stage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();

        org.junit.jupiter.api.Assertions.assertThrows(com.example.smartrec.exception.BusinessException.class,
                () -> service.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                        .stage(PipelineStage.FFMPEG).status(JobStageStatus.SUCCESS).build()));

        assertEquals(JobStatus.PROCESSING, job.getStatus());
        assertEquals(JobStageStatus.PROCESSING, stage.getStatus());
        verify(jobStageRepository, never()).findByJobIdAndStage(jobId, PipelineStage.FFMPEG);
        verify(jobRepository, never()).save(job);
    }

    @Test
    void expiredLeaseCannotBeReclaimedWhileCancelOrPauseIsPending() {
        UUID previousExecution = UUID.randomUUID();
        job.setExecutionId(previousExecution);
        job.setLeaseExpiresAt(Instant.now().minusSeconds(1));
        when(mediaFileRepository.findById(job.getMediaFileId())).thenReturn(Optional.empty());
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of());

        job.setStatus(JobStatus.CANCEL_REQUESTED);
        assertFalse(service.workerHeartbeat(jobId, previousExecution).isExecutionAllowed());
        assertEquals(previousExecution, job.getExecutionId());
        assertEquals(JobStatus.CANCEL_REQUESTED, job.getStatus());

        job.setStatus(JobStatus.PAUSE_REQUESTED);
        assertFalse(service.workerHeartbeat(jobId, UUID.randomUUID()).isExecutionAllowed());
        assertEquals(previousExecution, job.getExecutionId());
        assertEquals(JobStatus.PAUSE_REQUESTED, job.getStatus());
    }

    @Test
    void currentExecutionWithLiveLeaseCanObservePendingCancelOrPause() {
        UUID executionId = UUID.randomUUID();
        job.setExecutionId(executionId);
        job.setLeaseExpiresAt(Instant.now().plusSeconds(30));
        when(mediaFileRepository.findById(job.getMediaFileId())).thenReturn(Optional.empty());
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of());

        job.setStatus(JobStatus.CANCEL_REQUESTED);
        org.junit.jupiter.api.Assertions.assertTrue(service.workerHeartbeat(jobId, executionId).isExecutionAllowed());
        assertEquals(JobStatus.CANCEL_REQUESTED, job.getStatus());

        job.setStatus(JobStatus.PAUSE_REQUESTED);
        org.junit.jupiter.api.Assertions.assertTrue(service.workerHeartbeat(jobId, executionId).isExecutionAllowed());
        assertEquals(JobStatus.PAUSE_REQUESTED, job.getStatus());
    }

    @Test
    void terminalJobDoesNotAcceptNewWorkerExecution() {
        UUID previousExecution = UUID.randomUUID();
        Instant expiredLease = Instant.now().minusSeconds(10);
        job.setStatus(JobStatus.COMPLETED);
        job.setExecutionId(previousExecution);
        job.setLeaseExpiresAt(expiredLease);
        when(mediaFileRepository.findById(job.getMediaFileId())).thenReturn(Optional.empty());
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of());

        assertFalse(service.workerHeartbeat(jobId, UUID.randomUUID()).isExecutionAllowed());
        assertEquals(JobStatus.COMPLETED, job.getStatus());
        assertEquals(previousExecution, job.getExecutionId());
        assertEquals(expiredLease, job.getLeaseExpiresAt());
    }

    @Test
    void successCallbackAfterCancelCannotCompleteOrSaveOutputSegments() {
        UUID executionId = UUID.randomUUID();
        job.setStatus(JobStatus.CANCEL_REQUESTED);
        job.setCurrentStage(PipelineStage.OUTPUT);
        job.setExecutionId(executionId);
        job.setLeaseExpiresAt(Instant.now().plusSeconds(60));
        JobStage output = JobStage.builder().jobId(jobId).stage(PipelineStage.OUTPUT)
                .status(JobStageStatus.PROCESSING).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.OUTPUT)).thenReturn(Optional.of(output));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of(output));

        service.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .executionId(executionId)
                .stage(PipelineStage.OUTPUT)
                .status(JobStageStatus.SUCCESS)
                .segments(List.of())
                .build());

        assertEquals(JobStatus.CANCELLED, job.getStatus());
        assertEquals(JobStageStatus.CANCELLED, output.getStatus());
        verify(speakerSegmentRepository, never()).deleteByMeetingId(meetingId);
        verify(speakerSegmentRepository, never()).saveAll(any());
    }

    @Test
    void callbackFromOlderExecutionIsRejected() {
        job.setExecutionId(UUID.randomUUID());
        job.setLeaseExpiresAt(Instant.now().plusSeconds(60));
        JobStage ffmpeg = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();
        org.junit.jupiter.api.Assertions.assertThrows(com.example.smartrec.exception.BusinessException.class,
                () -> service.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                        .executionId(UUID.randomUUID())
                        .stage(PipelineStage.FFMPEG)
                        .status(JobStageStatus.SUCCESS)
                        .build()));

        assertEquals(JobStageStatus.PROCESSING, ffmpeg.getStatus());
    }

    @Test
    void stalePauseRequestBecomesPausedInsteadOfRemainingPendingForever() {
        job.setStatus(JobStatus.PAUSE_REQUESTED);
        job.setLastHeartbeatAt(Instant.now().minusSeconds(180));
        JobStage stage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();
        when(jobRepository.findByStatusInOrderByUpdatedAtAsc(List.of(JobStatus.PROCESSING, JobStatus.RUNNING,
                JobStatus.RETRYING, JobStatus.PAUSE_REQUESTED, JobStatus.CANCEL_REQUESTED), PageRequest.of(0, 100)))
                .thenReturn(new PageImpl<>(List.of(job)));
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG)).thenReturn(Optional.of(stage));
        service.markStaleJobsFailed();

        assertEquals(JobStatus.PAUSED, job.getStatus());
        assertEquals(JobStageStatus.PAUSED, stage.getStatus());
        assertEquals(MeetingStatus.PAUSED, meeting.getStatus());
    }

    @Test
    void staleCancelRequestBecomesCancelledAfterExecutionLeaseExpires() {
        job.setStatus(JobStatus.CANCEL_REQUESTED);
        job.setLastHeartbeatAt(Instant.now().minusSeconds(180));
        JobStage current = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();
        JobStage output = JobStage.builder().jobId(jobId).stage(PipelineStage.OUTPUT)
                .status(JobStageStatus.PENDING).build();
        when(jobRepository.findByStatusInOrderByUpdatedAtAsc(List.of(JobStatus.PROCESSING, JobStatus.RUNNING,
                JobStatus.RETRYING, JobStatus.PAUSE_REQUESTED, JobStatus.CANCEL_REQUESTED), PageRequest.of(0, 100)))
                .thenReturn(new PageImpl<>(List.of(job)));
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG)).thenReturn(Optional.of(current));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of(current, output));

        service.markStaleJobsFailed();

        assertEquals(JobStatus.CANCELLED, job.getStatus());
        assertEquals("CANCEL_RECOVERED_AFTER_WORKER_LOST", job.getErrorCode());
        assertEquals(JobStageStatus.CANCELLED, current.getStatus());
        assertEquals(JobStageStatus.SKIPPED, output.getStatus());
        assertEquals(MeetingStatus.CANCELLED, meeting.getStatus());
    }

    @Test
    void stalePyannoteWorkerLossFailsCurrentStageAndSkipsOutputWithoutTouchingSuccessfulStages() {
        job.setCurrentStage(PipelineStage.PYANNOTE);
        job.setLastHeartbeatAt(Instant.now().minusSeconds(180));
        JobStage ffmpeg = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.SUCCESS).build();
        JobStage webrtc = JobStage.builder().jobId(jobId).stage(PipelineStage.WEBRTC)
                .status(JobStageStatus.SUCCESS).build();
        JobStage pyannote = JobStage.builder().jobId(jobId).stage(PipelineStage.PYANNOTE)
                .status(JobStageStatus.PROCESSING).build();
        JobStage output = JobStage.builder().jobId(jobId).stage(PipelineStage.OUTPUT)
                .status(JobStageStatus.PENDING).build();
        when(jobRepository.findByStatusInOrderByUpdatedAtAsc(List.of(JobStatus.PROCESSING, JobStatus.RUNNING,
                JobStatus.RETRYING, JobStatus.PAUSE_REQUESTED, JobStatus.CANCEL_REQUESTED), PageRequest.of(0, 100)))
                .thenReturn(new PageImpl<>(List.of(job)));
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.PYANNOTE)).thenReturn(Optional.of(pyannote));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of(ffmpeg, webrtc, pyannote, output));

        service.markStaleJobsFailed();

        assertEquals(JobStatus.FAILED, job.getStatus());
        assertEquals("WORKER_LOST", job.getErrorCode());
        assertEquals(JobStageStatus.SUCCESS, ffmpeg.getStatus());
        assertEquals(JobStageStatus.SUCCESS, webrtc.getStatus());
        assertEquals(JobStageStatus.FAILED, pyannote.getStatus());
        assertEquals("WORKER_LOST", pyannote.getErrorCode());
        assertEquals(JobStageStatus.SKIPPED, output.getStatus());
        assertEquals(MeetingStatus.FAILED, meeting.getStatus());
    }
}
