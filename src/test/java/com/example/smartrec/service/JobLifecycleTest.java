package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.enums.PipelineStage;
import com.example.smartrec.model.dto.WorkerCallbackRequest;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobStageRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.impl.JobServiceImpl;

@ExtendWith(MockitoExtension.class)
class JobLifecycleTest {
    @Mock private JobRepository jobRepository;
    @Mock private JobStageRepository jobStageRepository;
    @Mock private JobQueueService jobQueueService;
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
        verify(jobQueueService, never()).enqueueJob(any());
    }

    @Test
    void heartbeatRefreshesLeaseWithoutChangingActiveState() {
        Instant old = Instant.now().minusSeconds(120);
        job.setLastHeartbeatAt(old);
        when(mediaFileRepository.findById(job.getMediaFileId())).thenReturn(Optional.empty());
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of());

        var response = service.workerHeartbeat(jobId);

        assertEquals(JobStatus.PROCESSING, response.getStatus());
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
        verify(jobQueueService).enqueueJob(jobId);
    }

    @Test
    void cancelRequestIsIdempotent() {
        service.cancelForCurrentUser(jobId);
        service.cancelForCurrentUser(jobId);

        assertEquals(JobStatus.CANCEL_REQUESTED, job.getStatus());
        assertEquals(com.example.smartrec.entity.MeetingStatus.CANCEL_REQUESTED, meeting.getStatus());
        verify(jobQueueService, never()).enqueueJob(any());
    }

    @Test
    void staleProcessingJobAndCurrentStageAreMarkedFailed() {
        job.setLastHeartbeatAt(Instant.now().minusSeconds(180));
        JobStage stage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();
        when(jobRepository.findByStatusIn(List.of(JobStatus.PROCESSING, JobStatus.RUNNING, JobStatus.RETRYING,
                JobStatus.PAUSE_REQUESTED)))
                .thenReturn(List.of(job));
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
        JobStage stage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();
        when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG)).thenReturn(Optional.of(stage));

        service.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PAUSED)
                .build());

        assertEquals(JobStatus.PAUSED, job.getStatus());
        assertEquals(JobStageStatus.PAUSED, stage.getStatus());
        assertEquals(MeetingStatus.PAUSED, meeting.getStatus());
    }

    @Test
    void stalePauseRequestFailsInsteadOfRemainingPendingForever() {
        job.setStatus(JobStatus.PAUSE_REQUESTED);
        job.setLastHeartbeatAt(Instant.now().minusSeconds(180));
        JobStage stage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();
        when(jobRepository.findByStatusIn(List.of(JobStatus.PROCESSING, JobStatus.RUNNING, JobStatus.RETRYING,
                JobStatus.PAUSE_REQUESTED))).thenReturn(List.of(job));
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG)).thenReturn(Optional.of(stage));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(List.of(stage));

        service.markStaleJobsFailed();

        assertEquals(JobStatus.FAILED, job.getStatus());
        assertEquals("WORKER_LOST", job.getErrorCode());
        assertEquals(MeetingStatus.FAILED, meeting.getStatus());
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
        when(jobRepository.findByStatusIn(List.of(JobStatus.PROCESSING, JobStatus.RUNNING, JobStatus.RETRYING,
                JobStatus.PAUSE_REQUESTED))).thenReturn(List.of(job));
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
