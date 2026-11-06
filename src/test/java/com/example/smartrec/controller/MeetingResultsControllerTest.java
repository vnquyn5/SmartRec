package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.never;
import static org.mockito.ArgumentMatchers.any;
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
        speaker.setAiLabel("SPEAKER 1");
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
        item.setDeadlineRaw("trong tuần tới");
        item.setSourceRefs(List.of("TRANSCRIPT:" + TRANSCRIPT_ID,
                "SLIDE_OCR:55555555-5555-4555-8555-555555555555"));
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of(item));

        var response = controller.getResults(MEETING_ID, JOB_ID).getBody();

        assertEquals(JobStatus.COMPLETED, response.jobStatus());
        assertEquals("Đã thống nhất gửi bản kế hoạch.", response.transcripts().get(0).textContent());
        assertEquals("Speaker 1", response.transcripts().get(0).speakerLabel());
        assertEquals("ATTRIBUTED", response.transcripts().get(0).attributionStatus());
        assertEquals(TRANSCRIPT_ID, response.transcripts().get(0).id());
        assertEquals(MEETING_ID, response.transcripts().get(0).meetingId());
        assertEquals(JOB_ID, response.transcripts().get(0).jobId());
        assertEquals(1000L, response.transcripts().get(0).startTimeMs());
        assertEquals(2000L, response.transcripts().get(0).endTimeMs());
        assertEquals("Gửi bản kế hoạch", response.actionItems().get(0).title());
        assertEquals("trong tuần tới", response.actionItems().get(0).deadlineRaw());
        assertEquals(TRANSCRIPT_ID, response.actionItems().get(0).sourceTranscriptId());
        assertEquals(List.of("TRANSCRIPT:" + TRANSCRIPT_ID,
                "SLIDE_OCR:55555555-5555-4555-8555-555555555555"),
                response.actionItems().get(0).sourceRefs());
        assertNull(response.actionItems().get(0).assigneeSpeakerId());
        assertNull(response.actionItems().get(0).assigneeName());
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
        verify(speakerRepository, never()).findAllById(any());
    }

    @Test
    void renameDisplayLabelDoesNotDropCanonicalTranscriptSpeakerId() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder().id(TRANSCRIPT_ID).meetingId(MEETING_ID)
                        .processingJobId(JOB_ID).speakerId(SPEAKER_SEGMENT_ID)
                        .attributionStatus("ATTRIBUTED").startTimeMs(1000L).endTimeMs(3000L)
                        .textContent("Attributed after a speaker rename").build()));
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_SEGMENT_ID);
        speaker.setMeetingId(MEETING_ID);
        speaker.setAiLabel("SPEAKER 1");
        speaker.setRealName("Minh");
        when(speakerRepository.findAllById(java.util.Set.of(SPEAKER_SEGMENT_ID))).thenReturn(List.of(speaker));
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(speaker));
        when(speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(MEETING_ID)).thenReturn(List.of(
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Minh").startTime(1.0).endTime(3.0).build()));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of());

        var result = controller.getResults(MEETING_ID, JOB_ID).getBody().transcripts().get(0);

        assertEquals(SPEAKER_SEGMENT_ID, result.speakerId());
        assertEquals("Minh", result.speakerLabel());
        assertEquals("ATTRIBUTED", result.attributionStatus());
    }

    @Test
    void readTimeLinksOnlyCitedAttributedFirstPersonTaskWithoutRequiringCustomName() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder().id(TRANSCRIPT_ID).meetingId(MEETING_ID)
                        .processingJobId(JOB_ID).speakerId(SPEAKER_SEGMENT_ID)
                        .attributionStatus("ATTRIBUTED").startTimeMs(1000L).endTimeMs(3000L)
                        .textContent("Mình sẽ hoàn thành việc kết nối giao diện trước ngày 10.").build()));
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_SEGMENT_ID);
        speaker.setMeetingId(MEETING_ID);
        speaker.setAiLabel("SPEAKER 1");
        when(speakerRepository.findAllById(java.util.Set.of(SPEAKER_SEGMENT_ID))).thenReturn(List.of(speaker));
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(speaker));
        when(speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(MEETING_ID)).thenReturn(List.of(
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("SPEAKER 1").startTime(1.0).endTime(3.0).build()));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        ActionItem item = new ActionItem();
        item.setId(UUID.randomUUID());
        item.setMeetingId(MEETING_ID);
        item.setProcessingJobId(JOB_ID);
        item.setTaskName("Kết nối giao diện");
        item.setStatus("OPEN");
        item.setSourceRefs(List.of("TRANSCRIPT:" + TRANSCRIPT_ID));
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of(item));

        var fullResult = controller.getResults(MEETING_ID, JOB_ID).getBody();
        var result = fullResult.actionItems().get(0);

        assertEquals(SPEAKER_SEGMENT_ID, result.assigneeSpeakerId());
        assertEquals("Speaker 1", result.assigneeName());
        assertEquals("FIRST_PERSON_COMMITMENT", result.assignmentProvenance());
        assertEquals("Speaker 1", fullResult.transcripts().get(0).speakerLabel());
        assertEquals(List.of("TRANSCRIPT:" + TRANSCRIPT_ID), result.sourceRefs());
        assertNull(item.getAssigneeSpeakerId());

        speaker.setRealName("Văn Quyền");
        var renamedResult = controller.getResults(MEETING_ID, JOB_ID).getBody();
        assertEquals("Văn Quyền", renamedResult.transcripts().get(0).speakerLabel());
        assertEquals("Văn Quyền", renamedResult.actionItems().get(0).assigneeName());
        assertEquals(SPEAKER_SEGMENT_ID, renamedResult.actionItems().get(0).assigneeSpeakerId());

        speaker.setRealName(null);
        var resetResult = controller.getResults(MEETING_ID, JOB_ID).getBody();
        assertEquals("Speaker 1", resetResult.transcripts().get(0).speakerLabel());
        assertEquals("Speaker 1", resetResult.actionItems().get(0).assigneeName());
        assertEquals(SPEAKER_SEGMENT_ID, resetResult.actionItems().get(0).assigneeSpeakerId());
        assertEquals(List.of("TRANSCRIPT:" + TRANSCRIPT_ID), resetResult.actionItems().get(0).sourceRefs());
        assertNull(item.getAssigneeSpeakerId());
    }

    @Test
    void persistedSpeakerLinkUsesDefaultNameAndKeepsItsIdAndSourcesAcrossRenames() {
        UUID sourceId = UUID.randomUUID();
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of());
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_SEGMENT_ID);
        speaker.setMeetingId(MEETING_ID);
        speaker.setAiLabel("SPEAKER 1");
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(speaker));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        ActionItem item = new ActionItem();
        item.setId(UUID.randomUUID());
        item.setMeetingId(MEETING_ID);
        item.setProcessingJobId(JOB_ID);
        item.setTaskName("Kiểm thử upload video");
        item.setAssigneeSpeakerId(SPEAKER_SEGMENT_ID);
        item.setAssignmentProvenance("FIRST_PERSON_COMMITMENT");
        item.setStatus("OPEN");
        item.setSourceRefs(List.of("TRANSCRIPT:" + sourceId));
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of(item));

        var initial = controller.getResults(MEETING_ID, JOB_ID).getBody().actionItems().get(0);
        assertEquals("Speaker 1", initial.assigneeName());
        assertEquals(SPEAKER_SEGMENT_ID, initial.assigneeSpeakerId());

        speaker.setRealName("Văn Quyền");
        var renamed = controller.getResults(MEETING_ID, JOB_ID).getBody().actionItems().get(0);
        assertEquals("Văn Quyền", renamed.assigneeName());
        assertEquals(SPEAKER_SEGMENT_ID, renamed.assigneeSpeakerId());

        speaker.setRealName(null);
        var reset = controller.getResults(MEETING_ID, JOB_ID).getBody().actionItems().get(0);
        assertEquals("Speaker 1", reset.assigneeName());
        assertEquals(SPEAKER_SEGMENT_ID, reset.assigneeSpeakerId());
        assertEquals(initial.sourceRefs(), reset.sourceRefs());
        assertEquals(SPEAKER_SEGMENT_ID, item.getAssigneeSpeakerId());
        assertEquals(List.of("TRANSCRIPT:" + sourceId), item.getSourceRefs());
    }

    @Test
    void userAssignedTaskIsNotReassignedFromFirstPersonEvidence() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder().id(TRANSCRIPT_ID).meetingId(MEETING_ID)
                        .processingJobId(JOB_ID).speakerId(SPEAKER_SEGMENT_ID)
                        .attributionStatus("ATTRIBUTED").startTimeMs(1000L).endTimeMs(3000L)
                        .textContent("Mình sẽ hoàn thành việc kiểm thử upload video.").build()));
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_SEGMENT_ID);
        speaker.setMeetingId(MEETING_ID);
        speaker.setAiLabel("SPEAKER 1");
        speaker.setRealName("Minh");
        when(speakerRepository.findAllById(java.util.Set.of(SPEAKER_SEGMENT_ID))).thenReturn(List.of(speaker));
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(speaker));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        ActionItem item = new ActionItem();
        item.setId(UUID.randomUUID());
        item.setMeetingId(MEETING_ID);
        item.setProcessingJobId(JOB_ID);
        item.setTaskName("Upload video tests");
        item.setAssigneeUserId(UUID.randomUUID());
        item.setStatus("OPEN");
        item.setSourceRefs(List.of("TRANSCRIPT:" + TRANSCRIPT_ID));
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of(item));

        var result = controller.getResults(MEETING_ID, JOB_ID).getBody().actionItems().get(0);

        assertNull(result.assigneeName());
        assertNull(result.assigneeSpeakerId());
        assertNull(result.assignmentProvenance());
    }

    @Test
    void explicitNamedAssignmentKeepsSpeakerLinkAndShowsCurrentSpeakerName() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of());
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_SEGMENT_ID);
        speaker.setMeetingId(MEETING_ID);
        speaker.setAiLabel("SPEAKER 1");
        speaker.setRealName("Lan Nguyen");
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(speaker));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        ActionItem item = new ActionItem();
        item.setId(UUID.randomUUID());
        item.setMeetingId(MEETING_ID);
        item.setProcessingJobId(JOB_ID);
        item.setTaskName("Login interface");
        item.setAssigneeName("Lan");
        item.setAssigneeSpeakerId(SPEAKER_SEGMENT_ID);
        item.setAssignmentProvenance("EXPLICIT_NAMED");
        item.setStatus("OPEN");
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of(item));

        var result = controller.getResults(MEETING_ID, JOB_ID).getBody().actionItems().get(0);

        assertEquals("Lan Nguyen", result.assigneeName());
        assertEquals(SPEAKER_SEGMENT_ID, result.assigneeSpeakerId());
        assertEquals("EXPLICIT_NAMED", result.assignmentProvenance());
    }

    @Test
    void recoversUnresolvedTranscriptLabelFromStrongSingleSpeakerTimelineOverlap() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder().id(TRANSCRIPT_ID).meetingId(MEETING_ID)
                        .processingJobId(JOB_ID).speakerId(null).attributionStatus("UNRESOLVED")
                        .startTimeMs(15980L).endTimeMs(17880L).textContent("Boundary drift")
                        .build()));
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_SEGMENT_ID);
        speaker.setMeetingId(MEETING_ID);
        speaker.setAiLabel("SPEAKER 1");
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(speaker));
        when(speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(MEETING_ID)).thenReturn(List.of(
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Speaker 1").startTime(15.961).endTime(17.868).build()));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of());

        var result = controller.getResults(MEETING_ID, JOB_ID).getBody().transcripts().get(0);

        assertEquals(SPEAKER_SEGMENT_ID, result.speakerId());
        assertEquals("Speaker 1", result.speakerLabel());
        assertEquals("ATTRIBUTED", result.attributionStatus());
    }

    @Test
    void leavesLowCoverageSingleSpeakerTranscriptUnresolved() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder().id(TRANSCRIPT_ID).meetingId(MEETING_ID)
                        .processingJobId(JOB_ID).speakerId(null).attributionStatus("UNRESOLVED")
                        .startTimeMs(28700L).endTimeMs(33400L).textContent("Mostly outside turns")
                        .build()));
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_SEGMENT_ID);
        speaker.setMeetingId(MEETING_ID);
        speaker.setAiLabel("SPEAKER 1");
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(speaker));
        when(speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(MEETING_ID)).thenReturn(List.of(
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Speaker 1").startTime(28.938).endTime(30.220).build(),
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Speaker 1").startTime(31.385).endTime(35.215).build()));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of());

        var result = controller.getResults(MEETING_ID, JOB_ID).getBody().transcripts().get(0);

        assertNull(result.speakerId());
        assertNull(result.speakerLabel());
        assertEquals("UNRESOLVED", result.attributionStatus());
    }

    @Test
    void persistedCrossBoundaryStatusDoesNotReceiveASpeakerFromTheTimeline() {
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder().id(TRANSCRIPT_ID).meetingId(MEETING_ID)
                        .processingJobId(JOB_ID).speakerId(null)
                        .attributionStatus("CROSS_SPEAKER_BOUNDARY").startTimeMs(17500L).endTimeMs(19000L)
                        .textContent("Crosses a diarization boundary").build()));
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
    void persistedAttributedSpeakerIdSurvivesTimelineCrossingAfterRename() {
        UUID secondSpeakerId = UUID.randomUUID();
        Speaker first = new Speaker();
        first.setId(SPEAKER_SEGMENT_ID);
        first.setMeetingId(MEETING_ID);
        first.setAiLabel("SPEAKER 1");
        first.setRealName("Minh");
        Speaker second = new Speaker();
        second.setId(secondSpeakerId);
        second.setMeetingId(MEETING_ID);
        second.setAiLabel("SPEAKER 2");
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                TranscriptResponse.builder().id(TRANSCRIPT_ID).meetingId(MEETING_ID)
                        .processingJobId(JOB_ID).speakerId(SPEAKER_SEGMENT_ID)
                        .attributionStatus("ATTRIBUTED").startTimeMs(1000L).endTimeMs(3000L)
                        .textContent("Persisted canonical speaker attribution").build()));
        when(speakerRepository.findAllById(java.util.Set.of(SPEAKER_SEGMENT_ID)))
                .thenReturn(List.of(first));
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(first, second));
        when(speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(MEETING_ID)).thenReturn(List.of(
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Minh").startTime(1.0).endTime(2.0).build(),
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("SPEAKER 2").startTime(2.0).endTime(3.0).build()));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of());

        var result = controller.getResults(MEETING_ID, JOB_ID).getBody().transcripts().get(0);

        assertEquals(SPEAKER_SEGMENT_ID, result.speakerId());
        assertEquals("Minh", result.speakerLabel());
        assertEquals("ATTRIBUTED", result.attributionStatus());
    }

    @Test
    void defaultLabelsLinkOnlySupportedFirstPersonItemsAmongFivePersistedItems() {
        UUID speakerThreeId = UUID.randomUUID();
        UUID uploadTranscriptId = UUID.randomUUID();
        UUID boundaryTranscriptId = UUID.randomUUID();
        UUID evidenceTranscriptId = UUID.randomUUID();
        UUID databaseTranscriptId = UUID.randomUUID();
        UUID reportTranscriptId = UUID.randomUUID();
        Speaker speakerOne = new Speaker();
        speakerOne.setId(SPEAKER_SEGMENT_ID);
        speakerOne.setMeetingId(MEETING_ID);
        speakerOne.setAiLabel("SPEAKER 1");
        Speaker speakerThree = new Speaker();
        speakerThree.setId(speakerThreeId);
        speakerThree.setMeetingId(MEETING_ID);
        speakerThree.setAiLabel("SPEAKER 3");

        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                transcript(uploadTranscriptId, speakerThreeId, "ATTRIBUTED", 34360L, 42880L,
                        "Mình nhận nhiệm vụ kiểm thử chức năng upload video và kiểm tra kết quả transcript."),
                transcript(boundaryTranscriptId, null, "CROSS_SPEAKER_BOUNDARY", 26240L, 34100L,
                        "Mình sẽ hoàn thành việc kết nối giao diện quản lý cuộc họp với Backend."),
                transcript(evidenceTranscriptId, speakerThreeId, "ATTRIBUTED", 58120L, 62260L,
                        "Mình sẽ kiểm thử tính năng bấm vào Evidence để chuyển audio đến đúng thời điểm."),
                transcript(databaseTranscriptId, SPEAKER_SEGMENT_ID, "ATTRIBUTED", 43160L, 51180L,
                        "Mình phụ trách thiết kế và tối ưu cơ sở dữ liệu PostgreSQL. Mình sẽ hoàn thành công việc."),
                transcript(reportTranscriptId, speakerThreeId, "ATTRIBUTED", 62880L, 66940L,
                        "Mình sẽ báo cáo kết quả vào ngày 14 tháng 11 năm 2026.")));
        when(speakerRepository.findAllById(java.util.Set.of(SPEAKER_SEGMENT_ID, speakerThreeId)))
                .thenReturn(List.of(speakerOne, speakerThree));
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(speakerOne, speakerThree));
        when(speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(MEETING_ID)).thenReturn(List.of(
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Anh Quyền").startTime(43.0).endTime(51.4).build(),
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("SPEAKER 3").startTime(34.3).endTime(42.9).build(),
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("SPEAKER 3").startTime(58.0).endTime(67.0).build()));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        List<ActionItem> items = List.of(
                action("Upload video testing", uploadTranscriptId),
                action("Connect meeting UI to Backend", boundaryTranscriptId),
                action("Test Evidence seek", evidenceTranscriptId),
                action("Design PostgreSQL", databaseTranscriptId),
                action("Report results", reportTranscriptId));
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(items);

        var withDefaults = controller.getResults(MEETING_ID, JOB_ID).getBody();
        assertEquals(speakerThreeId, withDefaults.actionItems().get(0).assigneeSpeakerId());
        assertEquals("Speaker 3", withDefaults.actionItems().get(0).assigneeName());
        assertNull(withDefaults.actionItems().get(1).assigneeSpeakerId());
        assertNull(withDefaults.actionItems().get(1).assigneeName());
        assertEquals(speakerThreeId, withDefaults.actionItems().get(2).assigneeSpeakerId());
        assertEquals("Speaker 3", withDefaults.actionItems().get(2).assigneeName());
        assertEquals(SPEAKER_SEGMENT_ID, withDefaults.actionItems().get(3).assigneeSpeakerId());
        assertEquals("Speaker 1", withDefaults.actionItems().get(3).assigneeName());
        assertEquals(speakerThreeId, withDefaults.actionItems().get(4).assigneeSpeakerId());
        assertEquals("Speaker 3", withDefaults.actionItems().get(4).assigneeName());

        // A legacy timeline alias does not supply a human name. Renaming only
        // changes the display name of tasks linked to that stable speaker ID.
        speakerOne.setRealName("Anh Quyền");
        var afterConfirmation = controller.getResults(MEETING_ID, JOB_ID).getBody();
        assertEquals(SPEAKER_SEGMENT_ID, afterConfirmation.actionItems().get(3).assigneeSpeakerId());
        assertEquals("Anh Quyền", afterConfirmation.actionItems().get(3).assigneeName());
        assertEquals("FIRST_PERSON_COMMITMENT", afterConfirmation.actionItems().get(3).assignmentProvenance());
        assertEquals(speakerThreeId, afterConfirmation.actionItems().get(0).assigneeSpeakerId());
        assertEquals("Speaker 3", afterConfirmation.actionItems().get(0).assigneeName());
        assertNull(afterConfirmation.actionItems().get(1).assigneeSpeakerId());
        assertEquals(speakerThreeId, afterConfirmation.actionItems().get(2).assigneeSpeakerId());
        assertEquals("Speaker 3", afterConfirmation.actionItems().get(2).assigneeName());
        assertEquals(speakerThreeId, afterConfirmation.actionItems().get(4).assigneeSpeakerId());
        assertEquals("Speaker 3", afterConfirmation.actionItems().get(4).assigneeName());

        speakerOne.setRealName("Quyen Nguyen");
        var afterRename = controller.getResults(MEETING_ID, JOB_ID).getBody();

        assertEquals("Quyen Nguyen", afterRename.transcripts().stream()
                .filter(item -> SPEAKER_SEGMENT_ID.equals(item.speakerId())).findFirst().orElseThrow().speakerLabel());
        assertEquals(SPEAKER_SEGMENT_ID, afterRename.actionItems().get(3).assigneeSpeakerId());
        assertEquals("Quyen Nguyen", afterRename.actionItems().get(3).assigneeName());
        assertEquals(speakerThreeId, afterRename.actionItems().get(0).assigneeSpeakerId());
        assertEquals("Speaker 3", afterRename.actionItems().get(0).assigneeName());
        assertNull(afterRename.actionItems().get(1).assigneeSpeakerId());
        assertEquals(speakerThreeId, afterRename.actionItems().get(2).assigneeSpeakerId());
        assertEquals(speakerThreeId, afterRename.actionItems().get(4).assigneeSpeakerId());

        speakerOne.setRealName(null);
        var afterReset = controller.getResults(MEETING_ID, JOB_ID).getBody();
        assertEquals("Speaker 1", afterReset.transcripts().stream()
                .filter(item -> SPEAKER_SEGMENT_ID.equals(item.speakerId())).findFirst().orElseThrow().speakerLabel());
        assertEquals(SPEAKER_SEGMENT_ID, afterReset.actionItems().get(3).assigneeSpeakerId());
        assertEquals("Speaker 1", afterReset.actionItems().get(3).assigneeName());
        assertEquals(withDefaults.actionItems().get(3).sourceRefs(), afterReset.actionItems().get(3).sourceRefs());
        assertNull(items.get(3).getAssigneeSpeakerId());
    }

    @Test
    void differentLegacyLabelsForOneCanonicalSpeakerDoNotCreateFalseBoundary() {
        UUID attributedTranscriptId = UUID.randomUUID();
        UUID unresolvedTranscriptId = UUID.randomUUID();
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_SEGMENT_ID);
        speaker.setMeetingId(MEETING_ID);
        speaker.setAiLabel("SPEAKER 1");
        speaker.setRealName("Minh");
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(meetingResponse(MEETING_ID));
        when(jobService.getJobForCurrentUser(JOB_ID)).thenReturn(jobResponse(MEETING_ID));
        when(transcriptService.getTranscriptsByJob(JOB_ID)).thenReturn(List.of(
                transcript(attributedTranscriptId, SPEAKER_SEGMENT_ID, "ATTRIBUTED", 1000L, 3000L,
                        "Canonical attribution evidence"),
                transcript(unresolvedTranscriptId, null, "UNRESOLVED", 1000L, 3000L,
                        "Legacy label aliases for one speaker")));
        when(speakerRepository.findAllById(java.util.Set.of(SPEAKER_SEGMENT_ID))).thenReturn(List.of(speaker));
        when(speakerRepository.findByMeetingId(MEETING_ID)).thenReturn(List.of(speaker));
        when(speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(MEETING_ID)).thenReturn(List.of(
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Minh").startTime(1.0).endTime(2.0).build(),
                com.example.smartrec.entity.SpeakerSegment.builder().meetingId(MEETING_ID)
                        .speakerLabel("Anh Minh").startTime(2.0).endTime(3.0).build()));
        when(summaryRepository.findByProcessingJobId(JOB_ID)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(JOB_ID)).thenReturn(List.of());

        var result = controller.getResults(MEETING_ID, JOB_ID).getBody().transcripts().stream()
                .filter(item -> unresolvedTranscriptId.equals(item.id())).findFirst().orElseThrow();

        assertEquals(SPEAKER_SEGMENT_ID, result.speakerId());
        assertEquals("Minh", result.speakerLabel());
        assertEquals("ATTRIBUTED", result.attributionStatus());
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

    private TranscriptResponse transcript(
            UUID id, UUID speakerId, String status, long start, long end, String text) {
        return TranscriptResponse.builder().id(id).meetingId(MEETING_ID).processingJobId(JOB_ID)
                .speakerId(speakerId).attributionStatus(status).startTimeMs(start).endTimeMs(end)
                .textContent(text).build();
    }

    private ActionItem action(String title, UUID transcriptId) {
        ActionItem item = new ActionItem();
        item.setId(UUID.randomUUID());
        item.setMeetingId(MEETING_ID);
        item.setProcessingJobId(JOB_ID);
        item.setTaskName(title);
        item.setStatus("OPEN");
        item.setSourceRefs(List.of("TRANSCRIPT:" + transcriptId));
        return item;
    }
}
