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
import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.entity.MeetingSlide;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.enums.PipelineStage;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.TranscriptResponse;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.repository.MeetingSlideRepository;
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
    private SpeakerSegmentRepository speakerSegmentRepository;
    @Mock
    private MeetingSlideRepository meetingSlideRepository;
    @InjectMocks
    private MeetingResultsController controller;

    @org.junit.jupiter.api.BeforeEach
    void defaultSlidesToEmpty() {
        org.mockito.Mockito.lenient()
                .when(meetingSlideRepository.findByMeetingIdAndJobIdOrderByTimestampMsAsc(
                        org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of());
    }

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
        SpeakerSegment speakerSegment = new SpeakerSegment();
        speakerSegment.setId(SPEAKER_SEGMENT_ID);
        speakerSegment.setMeetingId(MEETING_ID);
        speakerSegment.setSpeakerLabel("SPEAKER_01");
        when(speakerSegmentRepository.findAllById(java.util.Set.of(SPEAKER_SEGMENT_ID)))
                .thenReturn(List.of(speakerSegment));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.of(summary));
        MeetingSlide slide = new MeetingSlide();
        slide.setSlideId(UUID.randomUUID());
        slide.setMeetingId(MEETING_ID);
        slide.setJobId(JOB_ID);
        slide.setTimestampMs(2500L);
        slide.setObjectKey("meetings/meeting/jobs/job/ocr/slide.jpg");
        slide.setOcrText("PostgreSQL");
        when(meetingSlideRepository.findByMeetingIdAndJobIdOrderByTimestampMsAsc(MEETING_ID, JOB_ID))
                .thenReturn(List.of(slide));

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
        assertEquals("Gửi bản kế hoạch", response.actionItems().get(0).title());
        assertEquals("trong tuần tới", response.actionItems().get(0).deadlineRaw());
        assertEquals(TRANSCRIPT_ID, response.actionItems().get(0).sourceTranscriptId());
        assertEquals("Gửi bản kế hoạch", response.summary().details().path("decisions").path(0).path("text").asText());
        assertEquals("PROCESSED", response.llmStatus());
        assertEquals("COMPLETED", response.ocrStatus());
        assertEquals("PostgreSQL", response.slides().get(0).ocrText());
        verify(meetingService).getMeeting(MEETING_ID);
        verify(jobService).getJobForCurrentUser(JOB_ID);
    }

    @Test
    void rejectsJobFromDifferentMeetingBeforeReadingArtifacts() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(UUID.randomUUID()));

        BusinessException error = assertThrows(
                BusinessException.class, () -> controller.getResults(MEETING_ID, JOB_ID));

        assertEquals("MEETING_JOB_NOT_FOUND", error.getCode());
        verifyNoInteractions(transcriptService, summaryRepository, actionItemRepository, speakerSegmentRepository);
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
        assertEquals("NOT_PROCESSED", response.llmStatus());
        assertEquals("NO_SLIDES_DETECTED", response.ocrStatus());
        assertEquals(List.of(), response.slides());
    }

    @Test
    void distinguishesOcrNotProcessedFromOutputFailure() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of());
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of());

        JobResponse processing = jobResponse(MEETING_ID);
        processing.setStatus(JobStatus.PROCESSING);
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(processing);
        assertEquals("NOT_PROCESSED", controller.getResults(MEETING_ID, JOB_ID).getBody().ocrStatus());

        JobResponse failedAtOutput = jobResponse(MEETING_ID);
        failedAtOutput.setStatus(JobStatus.FAILED);
        failedAtOutput.setStage(PipelineStage.OUTPUT);
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(failedAtOutput);
        assertEquals("FAILED", controller.getResults(MEETING_ID, JOB_ID).getBody().ocrStatus());
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
