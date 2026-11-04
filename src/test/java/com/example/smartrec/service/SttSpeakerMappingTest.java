package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.RestTemplate;

import com.example.smartrec.config.SttProperties;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.Transcript;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.SttResultRequest;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.repository.TranscriptRepository;
import com.example.smartrec.service.impl.SttServiceImpl;

@ExtendWith(MockitoExtension.class)
class SttSpeakerMappingTest {

    @Mock
    private TranscriptRepository transcriptRepository;

    @Mock
    private SpeakerRepository speakerRepository;

    @Mock
    private JobRepository jobRepository;

    @Mock
    private com.example.smartrec.repository.MeetingRepository meetingRepository;

    @Mock
    private SttProperties properties;

    @Mock
    private RestTemplate restTemplate;

    @InjectMocks
    private SttServiceImpl service;

    private void stubJob(UUID meetingId, UUID jobId) {
        Job job = Job.builder()
                .id(jobId)
                .meetingId(meetingId)
                .status(JobStatus.PROCESSING)
                .build();

        when(jobRepository.findByIdForUpdate(jobId))
                .thenReturn(Optional.of(job));
    }

    private SttResultRequest request(
            UUID meetingId,
            UUID jobId,
            String speakerLabel,
            UUID speakerId) {

        SttResultRequest request = new SttResultRequest();
        request.setMeetingId(meetingId);
        request.setProcessingJobId(jobId);
        request.setSuccess(true);
        request.setLanguage("vi");
        request.setModelName("whisper");

        SttResultRequest.TranscriptSegment segment =
                new SttResultRequest.TranscriptSegment();

        segment.setSpeakerLabel(speakerLabel);
        segment.setSpeakerId(speakerId);
        segment.setStartTimeMs(1000L);
        segment.setEndTimeMs(2000L);
        segment.setText("Hoàn thành tích hợp STT.");

        request.setSegments(List.of(segment));
        return request;
    }

    @Test
    void newSpeaker_shouldPersistBeforeTranscript() {
        UUID meetingId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();

        stubJob(meetingId, jobId);

        UUID expectedId = UUID.nameUUIDFromBytes(
                ("smartrec:speaker:" + meetingId + ":SPEAKER_00")
                        .getBytes(StandardCharsets.UTF_8)
        );

        when(transcriptRepository
                .findByProcessingJobIdOrderByStartTimeMsAsc(jobId))
                .thenReturn(List.of());

        when(speakerRepository.findByMeetingIdAndAiLabel(
                meetingId, "SPEAKER_00"))
                .thenReturn(List.of());

        when(speakerRepository.findById(expectedId))
                .thenReturn(Optional.empty());

        service.receiveResult(
                request(meetingId, jobId, "SPEAKER_00", null)
        );

        InOrder order = inOrder(
                speakerRepository,
                transcriptRepository
        );

        order.verify(speakerRepository)
                .saveAndFlush(argThat(speaker ->
                        expectedId.equals(speaker.getId())
                        && meetingId.equals(speaker.getMeetingId())
                        && "SPEAKER_00".equals(speaker.getAiLabel())
                ));

        order.verify(transcriptRepository)
                .saveAll(argThat(segments -> {
                    var iterator = segments.iterator();

                    if (!iterator.hasNext()) {
                        return false;
                    }

                    Transcript saved = iterator.next();

                    return expectedId.equals(saved.getSpeakerId())
                            && meetingId.equals(saved.getMeetingId())
                            && jobId.equals(saved.getProcessingJobId())
                            && !iterator.hasNext();
                }));
    }

    @Test
    void existingSpeaker_shouldReuseUUID() {
        UUID meetingId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        UUID speakerId = UUID.randomUUID();

        stubJob(meetingId, jobId);

        Speaker existing = new Speaker();
        existing.setId(speakerId);
        existing.setMeetingId(meetingId);
        existing.setAiLabel("SPEAKER_00");

        when(transcriptRepository
                .findByProcessingJobIdOrderByStartTimeMsAsc(jobId))
                .thenReturn(List.of());

        when(speakerRepository.findByMeetingIdAndAiLabel(
                meetingId, "SPEAKER_00"))
                .thenReturn(List.of(existing));

        service.receiveResult(
                request(meetingId, jobId, "speaker_00", null)
        );

        verify(speakerRepository, never())
                .saveAndFlush(any(Speaker.class));

        verify(transcriptRepository)
                .saveAll(argThat(segments -> {
                    var iterator = segments.iterator();

                    return iterator.hasNext()
                            && speakerId.equals(
                                    iterator.next().getSpeakerId());
                }));
    }

    @Test
    void speakerFromOtherMeeting_shouldBeRejected() {
        UUID meetingId = UUID.randomUUID();
        UUID otherMeetingId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        UUID speakerId = UUID.randomUUID();

        stubJob(meetingId, jobId);

        Speaker foreignSpeaker = new Speaker();
        foreignSpeaker.setId(speakerId);
        foreignSpeaker.setMeetingId(otherMeetingId);
        foreignSpeaker.setAiLabel("SPEAKER_00");

        when(transcriptRepository
                .findByProcessingJobIdOrderByStartTimeMsAsc(jobId))
                .thenReturn(List.of());

        when(speakerRepository.findById(speakerId))
                .thenReturn(Optional.of(foreignSpeaker));

        assertThrows(
                BusinessException.class,
                () -> service.receiveResult(
                        request(meetingId, jobId, null, speakerId))
        );

        verify(transcriptRepository, never())
                .saveAll(anyList());
    }

    @Test
    void duplicateCallback_shouldNotDuplicateTranscript() {
        UUID meetingId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();

        stubJob(meetingId, jobId);

        Transcript saved = new Transcript();
        saved.setMeetingId(meetingId);
        saved.setProcessingJobId(jobId);

        when(transcriptRepository
                .findByProcessingJobIdOrderByStartTimeMsAsc(jobId))
                .thenReturn(List.of(saved));

        service.receiveResult(
                request(meetingId, jobId, "SPEAKER_00", null)
        );

        verify(transcriptRepository, never())
                .saveAll(anyList());

        verifyNoInteractions(speakerRepository);
    }

    @Test
    void callbackForWrongMeeting_shouldNotReadOrWriteTranscript() {
        UUID jobId = UUID.randomUUID();
        stubJob(UUID.randomUUID(), jobId);
        assertThrows(BusinessException.class, () -> service.receiveResult(
                request(UUID.randomUUID(), jobId, "SPEAKER_00", null)));
        verifyNoInteractions(transcriptRepository, speakerRepository);
    }

    @Test
    void leasedCallbackRequiresCurrentExecutionAndLiveLease() {
        UUID meeting = UUID.randomUUID(), id = UUID.randomUUID(), execution = UUID.randomUUID();
        Job job = Job.builder().id(id).meetingId(meeting).status(JobStatus.PROCESSING)
                .currentStage(com.example.smartrec.enums.PipelineStage.OUTPUT)
                .executionId(execution).leaseExpiresAt(java.time.Instant.now().plusSeconds(60)).build();
        when(jobRepository.findByIdForUpdate(id)).thenReturn(Optional.of(job));
        var req = request(meeting, id, "SPEAKER_00", null);
        assertThrows(BusinessException.class, () -> service.receiveResult(req));
        assertThrows(BusinessException.class, () -> service.receiveResult(req, UUID.randomUUID()));
        job.setLeaseExpiresAt(java.time.Instant.now().minusSeconds(1));
        assertThrows(BusinessException.class, () -> service.receiveResult(req, execution));
        verifyNoInteractions(transcriptRepository, speakerRepository, meetingRepository);
    }

    @Test
    void leasedDuplicateIsFencedAndDoesNotWriteOrCompleteJob() {
        UUID meeting = UUID.randomUUID(), id = UUID.randomUUID(), execution = UUID.randomUUID();
        Job job = Job.builder().id(id).meetingId(meeting).status(JobStatus.PROCESSING)
                .currentStage(com.example.smartrec.enums.PipelineStage.OUTPUT)
                .executionId(execution).leaseExpiresAt(java.time.Instant.now().plusSeconds(60)).build();
        when(jobRepository.findByIdForUpdate(id)).thenReturn(Optional.of(job));
        var active = new com.example.smartrec.entity.Meeting();
        active.setActive_job_id(id);
        when(meetingRepository.findById(meeting)).thenReturn(Optional.of(active));
        var transcript = new Transcript();
        transcript.setMeetingId(meeting);
        when(transcriptRepository.findByProcessingJobIdOrderByStartTimeMsAsc(id)).thenReturn(List.of(transcript));
        service.receiveResult(request(meeting, id, "SPEAKER_00", null), execution);
        InOrder order = inOrder(jobRepository, transcriptRepository);
        order.verify(jobRepository).findByIdForUpdate(id);
        order.verify(transcriptRepository).findByProcessingJobIdOrderByStartTimeMsAsc(id);
        verify(transcriptRepository, never()).saveAll(any());
        verify(jobRepository, never()).save(any());
        assertEquals(JobStatus.PROCESSING, job.getStatus());
        active.setActive_job_id(UUID.randomUUID());
        assertThrows(BusinessException.class, () -> service.receiveResult(request(meeting, id, "SPEAKER_00", null), execution));
    }

    @Test
    void pausedCancelledAndTerminalJobsRejectTranscriptWrites() {
        UUID meeting = UUID.randomUUID(), id = UUID.randomUUID();
        Job job = Job.builder().id(id).meetingId(meeting).build();
        when(jobRepository.findByIdForUpdate(id)).thenReturn(Optional.of(job));
        for (JobStatus status : List.of(JobStatus.PAUSE_REQUESTED, JobStatus.PAUSED,
                JobStatus.CANCEL_REQUESTED, JobStatus.CANCELLED, JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.DLQ)) {
            job.setStatus(status);
            assertThrows(BusinessException.class, () -> service.receiveResult(request(meeting, id, "SPEAKER_00", null)));
        }
        verifyNoInteractions(transcriptRepository, speakerRepository);
    }

    @Test
    void failedSttDoesNotBypassStageFailureLifecycle() {
        UUID meeting = UUID.randomUUID(), id = UUID.randomUUID();
        Job job = Job.builder().id(id).meetingId(meeting).status(JobStatus.PROCESSING).build();
        when(jobRepository.findByIdForUpdate(id)).thenReturn(Optional.of(job));
        var req = request(meeting, id, "SPEAKER_00", null);
        req.setSuccess(false);
        assertThrows(BusinessException.class, () -> service.receiveResult(req));
        assertEquals(JobStatus.PROCESSING, job.getStatus());
        verify(jobRepository, never()).save(any());
        verifyNoInteractions(transcriptRepository, speakerRepository);
    }
}
