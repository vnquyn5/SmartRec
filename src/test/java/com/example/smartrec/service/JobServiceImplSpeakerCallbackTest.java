package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.test.util.ReflectionTestUtils;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.exception.BusinessException;
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
class JobServiceImplSpeakerCallbackTest {
    @Mock private JobRepository jobRepository;
    @Mock private JobStageRepository jobStageRepository;
    @Mock private JobQueueService jobQueueService;
    @Mock private MediaFileRepository mediaFileRepository;
    @Mock private SpeakerSegmentRepository speakerSegmentRepository;
    @Mock private MeetingRepository meetingRepository;
    @Mock private MeetingService meetingService;
    @InjectMocks private JobServiceImpl jobService;

    private UUID jobId;
    private UUID meetingId;
    private Job job;
    private JobStage outputStage;
    private Meeting meeting;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(jobService, "maxRetry", 5);
        jobId = UUID.randomUUID();
        meetingId = UUID.randomUUID();
        job = Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING)
                .currentStage(PipelineStage.OUTPUT).build();
        outputStage = JobStage.builder().jobId(jobId).stage(PipelineStage.OUTPUT)
                .status(JobStageStatus.PROCESSING).build();
        meeting = Meeting.builder().id(meetingId).build();
        org.mockito.Mockito.lenient().when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        org.mockito.Mockito.lenient().when(meetingRepository.findById(meetingId)).thenReturn(Optional.of(meeting));
    }

    @Test
    void outputSuccessWithEmptySegmentsClearsOldResultsAndCompletesMeeting() {
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.OUTPUT))
                .thenReturn(Optional.of(outputStage));
        WorkerCallbackRequest request = WorkerCallbackRequest.builder()
                .stage(PipelineStage.OUTPUT).status(JobStageStatus.SUCCESS).segments(java.util.List.of()).build();

        jobService.handleWorkerCallback(jobId, request);

        verify(speakerSegmentRepository).deleteByMeetingId(meetingId);
        verify(speakerSegmentRepository, org.mockito.Mockito.never()).saveAll(any());
        verify(jobRepository).save(job);
        assertEquals(JobStatus.COMPLETED, job.getStatus());
        assertEquals(com.example.smartrec.entity.MeetingStatus.COMPLETED, meeting.getStatus());
    }

    @Test
    void intermediateSuccessAdvancesStageWithoutEnqueuingAnotherTask() {
        job.setCurrentStage(PipelineStage.FFMPEG);
        JobStage ffmpegStage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG))
                .thenReturn(Optional.of(ffmpegStage));

        jobService.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.FFMPEG).status(JobStageStatus.SUCCESS).build());

        assertEquals(JobStatus.QUEUED, job.getStatus());
        assertEquals(PipelineStage.WEBRTC, job.getCurrentStage());
        org.mockito.Mockito.verifyNoInteractions(jobQueueService);
    }

    @Test
    void processingCallbackInitializesExistingStageAndJob() {
        job.setStatus(JobStatus.QUEUED);
        job.setCurrentStage(PipelineStage.FFMPEG);
        JobStage ffmpegStage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PENDING).retryCount(0).createdAt(java.time.Instant.now()).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG))
                .thenReturn(Optional.of(ffmpegStage));

        jobService.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.FFMPEG).status(JobStageStatus.PROCESSING).build());

        assertEquals(JobStatus.PROCESSING, job.getStatus());
        assertEquals(PipelineStage.FFMPEG, job.getCurrentStage());
        assertEquals(JobStageStatus.PROCESSING, ffmpegStage.getStatus());
        assertEquals(0, ffmpegStage.getRetryCount());
        assertNotNull(ffmpegStage.getStartedAt());
        verify(jobStageRepository).save(ffmpegStage);
        verify(jobRepository).save(job);
        assertEquals(jobId, meeting.getActive_job_id());
        assertEquals(com.example.smartrec.entity.MeetingStatus.PROCESSING, meeting.getStatus());
    }

    @Test
    void repeatedProcessingCallbackReusesSameStageAndPreservesStartedAt() {
        job.setStatus(JobStatus.PROCESSING);
        job.setCurrentStage(PipelineStage.FFMPEG);
        java.time.Instant firstStartedAt = java.time.Instant.parse("2026-10-07T09:00:00Z");
        JobStage ffmpegStage = JobStage.builder().jobId(jobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PROCESSING).retryCount(0).createdAt(firstStartedAt)
                .startedAt(firstStartedAt).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.FFMPEG))
                .thenReturn(Optional.of(ffmpegStage));
        WorkerCallbackRequest request = WorkerCallbackRequest.builder()
                .stage(PipelineStage.FFMPEG).status(JobStageStatus.PROCESSING).build();

        jobService.handleWorkerCallback(jobId, request);
        jobService.handleWorkerCallback(jobId, request);

        assertEquals(JobStageStatus.PROCESSING, ffmpegStage.getStatus());
        assertEquals(firstStartedAt, ffmpegStage.getStartedAt());
        assertEquals(0, ffmpegStage.getRetryCount());
        verify(jobStageRepository, org.mockito.Mockito.times(2)).save(ffmpegStage);
    }

    @Test
    void callbackFromJobThatIsNoLongerActiveIsRejected() {
        meeting.setActive_job_id(UUID.randomUUID());

        assertThrows(BusinessException.class, () -> jobService.handleWorkerCallback(jobId,
                WorkerCallbackRequest.builder().stage(PipelineStage.OUTPUT)
                        .status(JobStageStatus.SUCCESS).segments(java.util.List.of()).build()));

        org.mockito.Mockito.verifyNoInteractions(speakerSegmentRepository);
    }

    @Test
    void noSpeechFailureIsTerminalAndDoesNotIncrementRetryCount() {
        job.setStatus(JobStatus.PROCESSING);
        job.setCurrentStage(PipelineStage.PYANNOTE);
        job.setRetryCount(0);
        JobStage pyannote = JobStage.builder().jobId(jobId).stage(PipelineStage.PYANNOTE)
                .status(JobStageStatus.PROCESSING).retryCount(0).createdAt(java.time.Instant.now()).build();
        JobStage output = JobStage.builder().jobId(jobId).stage(PipelineStage.OUTPUT)
                .status(JobStageStatus.PENDING).retryCount(0).createdAt(java.time.Instant.now()).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.PYANNOTE)).thenReturn(Optional.of(pyannote));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(java.util.List.of(pyannote, output));

        jobService.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.PYANNOTE).status(JobStageStatus.FAILED)
                .errorCode("NO_SPEECH_DETECTED").errorMessage("No speech").build());

        assertEquals(JobStatus.FAILED, job.getStatus());
        assertEquals(JobStageStatus.FAILED, pyannote.getStatus());
        assertEquals(0, job.getRetryCount());
        assertEquals(0, pyannote.getRetryCount());
        assertEquals("NO_SPEECH_DETECTED", job.getErrorCode());
        assertEquals("NO_SPEECH_DETECTED", pyannote.getErrorCode());
        assertEquals(JobStageStatus.SKIPPED, output.getStatus());
        assertEquals(com.example.smartrec.entity.MeetingStatus.FAILED, meeting.getStatus());
        verify(jobStageRepository).save(pyannote);
        verify(jobStageRepository).save(output);
    }

    @Test
    void terminalOutputStageIsNotOverwrittenWhenAnEarlierStageFails() {
        job.setStatus(JobStatus.PROCESSING);
        job.setCurrentStage(PipelineStage.PYANNOTE);
        JobStage pyannote = JobStage.builder().jobId(jobId).stage(PipelineStage.PYANNOTE)
                .status(JobStageStatus.PROCESSING).retryCount(0).createdAt(java.time.Instant.now()).build();
        JobStage output = JobStage.builder().jobId(jobId).stage(PipelineStage.OUTPUT)
                .status(JobStageStatus.SUCCESS).retryCount(0).createdAt(java.time.Instant.now()).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.PYANNOTE)).thenReturn(Optional.of(pyannote));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(java.util.List.of(pyannote, output));

        jobService.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.PYANNOTE).status(JobStageStatus.FAILED)
                .errorCode("NO_SPEECH_DETECTED").errorMessage("No speech").build());

        assertEquals(JobStageStatus.SUCCESS, output.getStatus());
        org.mockito.Mockito.verify(jobStageRepository, org.mockito.Mockito.never()).save(output);
    }

    @Test
    void terminalFailedOutputStageIsNotOverwrittenAsSkipped() {
        job.setStatus(JobStatus.PROCESSING);
        job.setCurrentStage(PipelineStage.PYANNOTE);
        JobStage pyannote = JobStage.builder().jobId(jobId).stage(PipelineStage.PYANNOTE)
                .status(JobStageStatus.PROCESSING).retryCount(0).createdAt(java.time.Instant.now()).build();
        JobStage output = JobStage.builder().jobId(jobId).stage(PipelineStage.OUTPUT)
                .status(JobStageStatus.FAILED).retryCount(0).createdAt(java.time.Instant.now()).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.PYANNOTE)).thenReturn(Optional.of(pyannote));
        when(jobStageRepository.findByJobIdOrderByStageAsc(jobId)).thenReturn(java.util.List.of(pyannote, output));

        jobService.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.PYANNOTE).status(JobStageStatus.FAILED)
                .errorCode("NO_SPEECH_DETECTED").errorMessage("No speech").build());

        assertEquals(JobStageStatus.FAILED, output.getStatus());
        org.mockito.Mockito.verify(jobStageRepository, org.mockito.Mockito.never()).save(output);
    }

    @Test
    void duplicateTerminalFailureCallbackDoesNotChangeFailureState() {
        job.setStatus(JobStatus.FAILED);
        job.setCurrentStage(PipelineStage.PYANNOTE);
        job.setErrorCode("NO_SPEECH_DETECTED");
        JobStage pyannote = JobStage.builder().jobId(jobId).stage(PipelineStage.PYANNOTE)
                .status(JobStageStatus.FAILED).retryCount(0).createdAt(java.time.Instant.now())
                .errorCode("NO_SPEECH_DETECTED").build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.PYANNOTE)).thenReturn(Optional.of(pyannote));

        jobService.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.PYANNOTE).status(JobStageStatus.FAILED)
                .errorCode("NO_SPEECH_DETECTED").errorMessage("duplicate").build());

        assertEquals(JobStatus.FAILED, job.getStatus());
        assertEquals(JobStageStatus.FAILED, pyannote.getStatus());
        assertEquals("NO_SPEECH_DETECTED", job.getErrorCode());
        org.mockito.Mockito.verify(jobStageRepository, org.mockito.Mockito.never()).save(pyannote);
        org.mockito.Mockito.verify(jobRepository, org.mockito.Mockito.never()).save(job);
    }

    @Test
    void retryableFailureStillUsesRetryPath() {
        job.setStatus(JobStatus.PROCESSING);
        job.setCurrentStage(PipelineStage.PYANNOTE);
        JobStage pyannote = JobStage.builder().jobId(jobId).stage(PipelineStage.PYANNOTE)
                .status(JobStageStatus.PROCESSING).retryCount(0).createdAt(java.time.Instant.now()).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.PYANNOTE)).thenReturn(Optional.of(pyannote));

        jobService.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.PYANNOTE).status(JobStageStatus.FAILED)
                .errorCode("RETRYABLE_PROCESSING_ERROR").errorMessage("timeout").build());

        assertEquals(JobStatus.RETRYING, job.getStatus());
        assertEquals(JobStageStatus.RETRYING, pyannote.getStatus());
        assertEquals(1, job.getRetryCount());
        assertEquals(1, pyannote.getRetryCount());
    }

    @Test
    void exhaustedRetryableFailureMovesJobToDlq() {
        job.setStatus(JobStatus.PROCESSING);
        job.setCurrentStage(PipelineStage.PYANNOTE);
        JobStage pyannote = JobStage.builder().jobId(jobId).stage(PipelineStage.PYANNOTE)
                .status(JobStageStatus.PROCESSING).retryCount(5).createdAt(java.time.Instant.now()).build();
        when(jobStageRepository.findByJobIdAndStage(jobId, PipelineStage.PYANNOTE)).thenReturn(Optional.of(pyannote));

        jobService.handleWorkerCallback(jobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.PYANNOTE).status(JobStageStatus.FAILED)
                .errorCode("RETRYABLE_PROCESSING_ERROR").errorMessage("timeout").build());

        assertEquals(JobStatus.DLQ, job.getStatus());
        assertEquals(JobStageStatus.FAILED, pyannote.getStatus());
        assertEquals(com.example.smartrec.entity.MeetingStatus.FAILED, meeting.getStatus());
    }

    @Test
    void processingOneJobDoesNotChangeAnotherJobsState() {
        job.setStatus(JobStatus.FAILED);
        UUID otherJobId = UUID.randomUUID();
        UUID otherMeetingId = UUID.randomUUID();
        Job otherJob = Job.builder().id(otherJobId).meetingId(otherMeetingId).status(JobStatus.QUEUED)
                .currentStage(PipelineStage.FFMPEG).retryCount(0).build();
        JobStage otherStage = JobStage.builder().jobId(otherJobId).stage(PipelineStage.FFMPEG)
                .status(JobStageStatus.PENDING).retryCount(0).createdAt(java.time.Instant.now()).build();
        Meeting otherMeeting = Meeting.builder().id(otherMeetingId).build();
        when(jobRepository.findById(otherJobId)).thenReturn(Optional.of(otherJob));
        when(jobStageRepository.findByJobIdAndStage(otherJobId, PipelineStage.FFMPEG)).thenReturn(Optional.of(otherStage));
        when(meetingRepository.findById(otherMeetingId)).thenReturn(Optional.of(otherMeeting));

        jobService.handleWorkerCallback(otherJobId, WorkerCallbackRequest.builder()
                .stage(PipelineStage.FFMPEG).status(JobStageStatus.PROCESSING).build());

        assertEquals(JobStatus.PROCESSING, otherJob.getStatus());
        assertEquals(JobStatus.FAILED, job.getStatus());
        assertEquals(JobStageStatus.PROCESSING, outputStage.getStatus());
        assertEquals(JobStageStatus.PROCESSING, otherStage.getStatus());
    }
}
