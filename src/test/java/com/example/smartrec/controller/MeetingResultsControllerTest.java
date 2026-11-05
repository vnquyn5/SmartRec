package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.TranscriptResponse;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.JobService;
import com.example.smartrec.service.MeetingService;
import com.example.smartrec.service.TranscriptService;
import com.fasterxml.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class MeetingResultsControllerTest {
    private static final UUID MEETING_ID = UUID.randomUUID();
    private static final UUID JOB_ID = UUID.randomUUID();
    private static final UUID TRANSCRIPT_ID = UUID.randomUUID();
    private static final UUID SPEAKER_SEGMENT_ID = UUID.randomUUID();

    @Mock
    private MeetingService meetingService;
    @Mock
    private JobService jobService;
    @Mock
    private TranscriptService transcriptService;
    @Mock
    private SummaryRepository summaryRepository;
    @Mock
    private ActionItemRepository actionItemRepository;
    @Mock
    private SpeakerRepository speakerRepository;
    @Mock
    private SpeakerSegmentRepository speakerSegmentRepository;
    @InjectMocks
    private MeetingResultsController controller;

    @Test
    void returnsOnlyResultsForAuthorizedMeetingJob() throws Exception {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder()
                        .id(TRANSCRIPT_ID)
                        .meetingId(MEETING_ID)
                        .processingJobId(JOB_ID)
                        .speakerId(SPEAKER_SEGMENT_ID)
                        .attributionStatus("ATTRIBUTED")
                        .startTimeMs(1000L)
                        .endTimeMs(2000L)
                        .textContent("Đã thống nhất gửi bản kế hoạch.")
                        .build()));
        Summary summary = new Summary();
        summary.setMeetingId(MEETING_ID);
        summary.setProcessingJobId(JOB_ID);
        summary.setExecutiveSummary("Cuộc họp thống nhất gửi bản kế hoạch.");
        summary.setRawLlmResponse(new ObjectMapper().readTree("""
                {"meetingSummary":{
                  "decisions":[{"text":"Gửi bản kế hoạch","source_refs":["TRANSCRIPT:%s"]}],
                  "action_items":[{"title":"Gửi bản kế hoạch","deadline":null,
                    "deadline_raw":"trong tuần tới","source_refs":["TRANSCRIPT:%s"]}]
                }}
                """.formatted(TRANSCRIPT_ID, TRANSCRIPT_ID)));
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_SEGMENT_ID);
        speaker.setMeetingId(MEETING_ID);
        speaker.setAiLabel("SPEAKER_01");
        when(speakerRepository.findAllById(java.util.Set.of(SPEAKER_SEGMENT_ID)))
                .thenReturn(List.of(speaker));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.of(summary));

        ActionItem item = new ActionItem();
        item.setId(UUID.randomUUID());
        item.setMeetingId(MEETING_ID);
        item.setProcessingJobId(JOB_ID);
        item.setTaskName("Gửi bản kế hoạch");
        item.setStatus("OPEN");
        item.setDueDate(null);
        item.setSourceTranscriptId(TRANSCRIPT_ID);
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of(item));

        var response = controller.getResults(MEETING_ID, JOB_ID).getBody();

        assertEquals(JobStatus.COMPLETED, response.jobStatus());
        assertEquals("Đã thống nhất gửi bản kế hoạch.", response.transcripts().get(0).textContent());
        assertEquals("SPEAKER_01", response.transcripts().get(0).speakerLabel());
        assertEquals("ATTRIBUTED", response.transcripts().get(0).attributionStatus());
        assertEquals(TRANSCRIPT_ID, response.transcripts().get(0).id());
        assertEquals(MEETING_ID, response.transcripts().get(0).meetingId());
        assertEquals(JOB_ID, response.transcripts().get(0).jobId());
        assertEquals(1000L, response.transcripts().get(0).startTimeMs());
        assertEquals(2000L, response.transcripts().get(0).endTimeMs());
        assertEquals("Gửi bản kế hoạch", response.actionItems().get(0).title());
        assertEquals("trong tuần tới", response.actionItems().get(0).deadlineRaw());
        assertEquals(TRANSCRIPT_ID, response.actionItems().get(0).sourceTranscriptId());
        assertEquals("Gửi bản kế hoạch", response.summary().details().path("decisions").path(0).path("text").asText());
        verify(meetingService).getMeeting(MEETING_ID);
        verify(jobService).getJobForCurrentUser(JOB_ID);
    }

    @Test
    void returnsBoundaryAttributionWithoutInventingSpeakerLabel() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder()
                        .id(TRANSCRIPT_ID).meetingId(MEETING_ID).processingJobId(JOB_ID)
                        .speakerId(null).attributionStatus("CROSS_SPEAKER_BOUNDARY")
                        .startTimeMs(17500L).endTimeMs(19000L).textContent("Crossing turn")
                        .build()));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of());

        var transcript = controller.getResults(MEETING_ID, JOB_ID).getBody().transcripts().get(0);

        assertNull(transcript.speakerId());
        assertNull(transcript.speakerLabel());
        assertEquals("CROSS_SPEAKER_BOUNDARY", transcript.attributionStatus());
        assertEquals(17500L, transcript.startTimeMs());
        assertEquals(19000L, transcript.endTimeMs());
        verifyNoInteractions(speakerRepository);
    }

    @Test
    void legacyMajoritySpeakerIsReclassifiedWhenTranscriptCrossesPersistedTurns() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder().id(TRANSCRIPT_ID).meetingId(MEETING_ID)
                        .processingJobId(JOB_ID).speakerId(SPEAKER_SEGMENT_ID)
                        .attributionStatus("ATTRIBUTED").startTimeMs(17500L).endTimeMs(19000L)
                        .textContent("Crosses a diarization boundary").build()));
        Speaker existing = new Speaker();
        existing.setId(SPEAKER_SEGMENT_ID);
        existing.setMeetingId(MEETING_ID);
        existing.setAiLabel("SPEAKER 4");
        when(speakerRepository.findAllById(java.util.Set.of(SPEAKER_SEGMENT_ID))).thenReturn(List.of(existing));
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(existing));
        when(speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(MEETING_ID)).thenReturn(List.of(
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Speaker 3").startTime(17.5).endTime(18.037).build(),
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Speaker 4").startTime(18.037).endTime(19.0).build()));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of());

        var result = controller.getResults(MEETING_ID, JOB_ID).getBody().transcripts().get(0);

        assertNull(result.speakerId());
        assertNull(result.speakerLabel());
        assertEquals("CROSS_SPEAKER_BOUNDARY", result.attributionStatus());
        assertEquals(17500L, result.startTimeMs());
        assertEquals(19000L, result.endTimeMs());
    }

    @Test
    void rejectsJobFromDifferentMeetingBeforeReadingArtifacts() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(UUID.randomUUID()));

        BusinessException error = assertThrows(
                BusinessException.class, () -> controller.getResults(MEETING_ID, JOB_ID));

        assertEquals("MEETING_JOB_NOT_FOUND", error.getCode());
        verifyNoInteractions(transcriptService, summaryRepository, actionItemRepository, speakerRepository);
    }

    @Test
    void returnsExplicitEmptyResultsWhenArtifactsAreNotPersisted() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of());
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of());

        var response = controller.getResults(MEETING_ID, JOB_ID).getBody();

        assertNull(response.summary());
        assertEquals(List.of(), response.transcripts());
        assertEquals(List.of(), response.actionItems());
    }

    private MeetingResponseDTO meetingResponse(UUID meetingId) {
        return new MeetingResponseDTO(
                meetingId, "Meeting", MeetingStatus.PROCESSING, UUID.randomUUID(), "meeting.mp4",
                "video/mp4", 100L, 10, Instant.now(), Instant.now(), JOB_ID);
    }

    private JobResponse jobResponse(UUID meetingId) {
        return JobResponse.builder()
                .id(JOB_ID)
                .meetingId(meetingId)
                .status(JobStatus.COMPLETED)
                .build();
    }
}
