package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.Optional;
import java.util.UUID;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.Transcript;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.model.dto.AiUsageRequest;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.repository.TranscriptRepository;
import com.example.smartrec.service.AiUsageIngestionService;
import com.example.smartrec.service.impl.AIResponseValidatorImpl;
import com.example.smartrec.service.impl.AIResultServiceImpl;
import com.fasterxml.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class AIResultServiceImplTest {

    @Mock
    private JobRepository jobRepository;

    @Mock
    private SummaryRepository summaryRepository;

    @Mock
    private ActionItemRepository actionItemRepository;

    @Mock
    private SpeakerRepository speakerRepository;

    @Mock
    private TranscriptRepository transcriptRepository;

    @Mock
    private AiUsageIngestionService aiUsageIngestionService;

    @Spy
    private AIResponseValidatorImpl validator =
            new AIResponseValidatorImpl();

    @InjectMocks
    private AIResultServiceImpl service;

    private final ObjectMapper mapper = new ObjectMapper();

    private AIResponse createResponse(
            UUID jobId, UUID meetingId, String json) throws Exception {

        return AIResponse.builder()
                .jobId(jobId)
                .meetingId(meetingId)
                .requestId(UUID.randomUUID())
                .taskType("MEETING_ANALYSIS")
                .status("SUCCESS")
                .provider("LOCAL")
                .model("qwen2.5")
                .latencyMs(23L)
                .inputTokens(10L)
                .outputTokens(5L)
                .tokenSource("ollama_metadata")
                .result(mapper.readTree(json))
                .build();
    }

    private Transcript transcript(
            UUID meetingId, UUID jobId, UUID transcriptId, UUID speakerId, String status, String text) {
        Transcript transcript = new Transcript();
        transcript.setId(transcriptId);
        transcript.setMeetingId(meetingId);
        transcript.setProcessingJobId(jobId);
        transcript.setSpeakerId(speakerId);
        transcript.setAttributionStatus(status);
        transcript.setStartTimeMs(0L);
        transcript.setEndTimeMs(5000L);
        transcript.setTextContent(text);
        return transcript;
    }

    @Test
    void combinedResult_shouldPersistSummaryAndActionItems()
            throws Exception {

        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();

        Job job = Job.builder()
                .id(jobId)
                .meetingId(meetingId)
                .status(JobStatus.PROCESSING)
                .build();

        AIResponse response = createResponse(
                jobId,
                meetingId,
                """
                {
                  "executiveSummary": "Sprint 3 integration",
                  "actionItems": [
                    {
                      "taskName": "Complete STT integration",
                      "assigneeName": "Developer",
                      "status": "OPEN",
                      "dueDate": null,
                      "deadlineRaw": "trước thứ Sáu",
                      "sourceTranscriptId": null,
                      "sourceRefs": ["TRANSCRIPT:11111111-1111-4111-8111-111111111111",
                                     "SLIDE_OCR:22222222-2222-4222-8222-222222222222"]
                    }
                  ]
                }
                """
        );

        when(jobRepository.findByIdForUpdate(jobId))
                .thenReturn(Optional.of(job));

        when(summaryRepository.findByProcessingJobId(jobId))
                .thenReturn(Optional.empty());


        service.saveAIResult(response);

        ArgumentCaptor<Summary> summaryCaptor =
                ArgumentCaptor.forClass(Summary.class);

        verify(summaryRepository).save(summaryCaptor.capture());

        assertEquals(
                "Sprint 3 integration",
                summaryCaptor.getValue().getExecutiveSummary()
        );

        ArgumentCaptor<List<ActionItem>> actionCaptor = ArgumentCaptor.forClass(List.class);
        verify(actionItemRepository).saveAll(actionCaptor.capture());
        ActionItem savedAction = actionCaptor.getValue().get(0);
        assertEquals("trước thứ Sáu", savedAction.getDeadlineRaw());
        assertEquals(List.of(
                "TRANSCRIPT:11111111-1111-4111-8111-111111111111",
                "SLIDE_OCR:22222222-2222-4222-8222-222222222222"), savedAction.getSourceRefs());
        assertNull(savedAction.getSourceTranscriptId());

        ArgumentCaptor<AiUsageRequest> usageCaptor = ArgumentCaptor.forClass(AiUsageRequest.class);
        verify(aiUsageIngestionService).record(usageCaptor.capture());
        AiUsageRequest usage = usageCaptor.getValue();
        assertEquals(response.getRequestId(), usage.getRequestId());
        assertEquals(jobId, usage.getJobId());
        assertEquals(meetingId, usage.getMeetingId());
        assertEquals("LOCAL", usage.getProvider());
        assertEquals("MEETING_ANALYSIS", usage.getTaskType());
        assertEquals(10L, usage.getInputTokens());
        assertEquals(5L, usage.getOutputTokens());
        assertEquals(15L, usage.getTotalTokens());
        assertEquals("ollama_metadata", usage.getTokenSource());
        assertEquals(23L, usage.getProcessingTimeMs());
        assertEquals("success", usage.getStatus());
    }

    @Test
    void firstPersonCommitmentLinksOnlyItsUnambiguouslyAttributedSpeaker() throws Exception {
        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        UUID transcriptId = UUID.randomUUID();
        UUID speakerId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING).build();
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(summaryRepository.findByProcessingJobId(jobId)).thenReturn(Optional.empty());
        Speaker speaker = new Speaker();
        speaker.setId(speakerId);
        speaker.setMeetingId(meetingId);
        speaker.setAiLabel("SPEAKER 1");
        speaker.setRealName("Minh");
        when(speakerRepository.findById(speakerId)).thenReturn(Optional.of(speaker));
        when(transcriptRepository.findAllById(List.of(transcriptId))).thenReturn(List.of(
                transcript(meetingId, jobId, transcriptId, speakerId,
                        "ATTRIBUTED", "Mình nhận nhiệm vụ kiểm thử chức năng upload video.")));
        AIResponse response = createResponse(jobId, meetingId, """
                {"executiveSummary":"Meeting summary","actionItems":[
                  {"taskName":"Kiểm thử upload video","assigneeName":null,"status":"OPEN",
                   "deadlineRaw":null,"sourceRefs":["TRANSCRIPT:%s"]}
                ]}
                """.formatted(transcriptId));

        service.saveAIResult(response);

        ArgumentCaptor<List<ActionItem>> captor = ArgumentCaptor.forClass(List.class);
        verify(actionItemRepository).saveAll(captor.capture());
        ActionItem saved = captor.getValue().get(0);
        assertEquals(speakerId, saved.getAssigneeSpeakerId());
        assertEquals("FIRST_PERSON_COMMITMENT", saved.getAssignmentProvenance());
        assertNull(saved.getAssigneeName());
    }

    @Test
    void genericDiscussionAndUnattributedSpeechKeepAssigneeUnknown() throws Exception {
        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        UUID genericTranscriptId = UUID.randomUUID();
        UUID boundaryTranscriptId = UUID.randomUUID();
        UUID speakerId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING).build();
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(summaryRepository.findByProcessingJobId(jobId)).thenReturn(Optional.empty());
        when(transcriptRepository.findAllById(List.of(genericTranscriptId))).thenReturn(List.of(
                transcript(meetingId, jobId, genericTranscriptId, speakerId,
                        "ATTRIBUTED", "Chúng ta cần kiểm tra chức năng upload video.")));
        when(transcriptRepository.findAllById(List.of(boundaryTranscriptId))).thenReturn(List.of(
                transcript(meetingId, jobId, boundaryTranscriptId, null,
                        "CROSS_SPEAKER_BOUNDARY", "Mình sẽ hoàn thành phần tích hợp.")));
        AIResponse response = createResponse(jobId, meetingId, """
                {"executiveSummary":"Meeting summary","actionItems":[
                  {"taskName":"Review upload video","assigneeName":null,"status":"OPEN",
                   "deadlineRaw":null,"sourceRefs":["TRANSCRIPT:%s"]},
                  {"taskName":"Complete integration","assigneeName":null,"status":"OPEN",
                   "deadlineRaw":null,"sourceRefs":["TRANSCRIPT:%s"]}
                ]}
                """.formatted(genericTranscriptId, boundaryTranscriptId));

        service.saveAIResult(response);

        ArgumentCaptor<List<ActionItem>> captor = ArgumentCaptor.forClass(List.class);
        verify(actionItemRepository).saveAll(captor.capture());
        assertNull(captor.getValue().get(0).getAssigneeSpeakerId());
        assertEquals("UNKNOWN", captor.getValue().get(0).getAssignmentProvenance());
        assertNull(captor.getValue().get(1).getAssigneeSpeakerId());
        assertEquals("UNKNOWN", captor.getValue().get(1).getAssignmentProvenance());
    }

    @Test
    void explicitNamedAssignmentLinksOnlyExactConfirmedSpeakerName() throws Exception {
        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        UUID speakerId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING).build();
        Speaker speaker = new Speaker();
        speaker.setId(speakerId);
        speaker.setMeetingId(meetingId);
        speaker.setAiLabel("SPEAKER 2");
        speaker.setRealName("Lan");
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(summaryRepository.findByProcessingJobId(jobId)).thenReturn(Optional.empty());
        when(speakerRepository.findByMeetingId(meetingId)).thenReturn(List.of(speaker));
        AIResponse response = createResponse(jobId, meetingId, """
                {"executiveSummary":"Meeting summary","actionItems":[
                  {"taskName":"Login interface","assigneeName":"Lan","status":"OPEN",
                   "deadlineRaw":null,"sourceRefs":[]}
                ]}
                """);

        service.saveAIResult(response);

        ArgumentCaptor<List<ActionItem>> captor = ArgumentCaptor.forClass(List.class);
        verify(actionItemRepository).saveAll(captor.capture());
        assertEquals("Lan", captor.getValue().get(0).getAssigneeName());
        assertEquals(speakerId, captor.getValue().get(0).getAssigneeSpeakerId());
        assertEquals("EXPLICIT_NAMED", captor.getValue().get(0).getAssignmentProvenance());
    }

    @Test
    void combinedResult_missingSummary_shouldBeRejected()
            throws Exception {

        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();

        AIResponse response = createResponse(
                jobId,
                meetingId,
                """
                {
                  "actionItems": []
                }
                """
        );

        assertThrows(
                BusinessException.class,
                () -> service.saveAIResult(response)
        );

        verifyNoInteractions(
                jobRepository,
                summaryRepository,
                actionItemRepository,
                aiUsageIngestionService
        );
    }

    @Test
    void combinedResult_invalidActionItems_shouldBeRejected()
            throws Exception {

        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();

        AIResponse response = createResponse(
                jobId,
                meetingId,
                """
                {
                  "executiveSummary": "Meeting summary",
                  "actionItems": "invalid"
                }
                """
        );

        assertThrows(
                BusinessException.class,
                () -> service.saveAIResult(response)
        );

        verifyNoInteractions(
                jobRepository,
                summaryRepository,
                actionItemRepository,
                aiUsageIngestionService
        );
    }

    @Test
    void persistenceFailureDoesNotRecordSuccessfulUsage() throws Exception {
        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING).build();
        AIResponse response = createResponse(jobId, meetingId, """
                {
                  "executiveSummary": "Meeting summary",
                  "actionItems": [{"taskName": "Follow up"}]
                }
                """);

        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(summaryRepository.findByProcessingJobId(jobId)).thenReturn(Optional.empty());
        doThrow(new IllegalStateException("simulated persistence failure"))
                .when(actionItemRepository).saveAll(anyList());

        assertThrows(IllegalStateException.class, () -> service.saveAIResult(response));
        verifyNoInteractions(aiUsageIngestionService);
    }

    @Test
    void missingTokenMetadataRemainsUnknownWhenRecordingUsage() throws Exception {
        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING).build();
        AIResponse response = createResponse(jobId, meetingId, """
                {"executiveSummary":"Meeting summary","actionItems":[]}
                """);
        response.setInputTokens(null);
        response.setOutputTokens(null);
        response.setTokenSource("unavailable");

        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(summaryRepository.findByProcessingJobId(jobId)).thenReturn(Optional.empty());

        service.saveAIResult(response);

        ArgumentCaptor<AiUsageRequest> usageCaptor = ArgumentCaptor.forClass(AiUsageRequest.class);
        verify(aiUsageIngestionService).record(usageCaptor.capture());
        assertNull(usageCaptor.getValue().getInputTokens());
        assertNull(usageCaptor.getValue().getOutputTokens());
        assertNull(usageCaptor.getValue().getTotalTokens());
        assertEquals("unavailable", usageCaptor.getValue().getTokenSource());
    }

    @Test
    void emptyActionItemsIsAValidPersistenceResult() throws Exception {
        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING).build();
        AIResponse response = createResponse(jobId, meetingId,
                "{\"executiveSummary\":\"Meeting summary\",\"actionItems\":[]}");
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(summaryRepository.findByProcessingJobId(jobId)).thenReturn(Optional.empty());

        service.saveAIResult(response);

        verify(actionItemRepository).findByProcessingJobId(jobId);
        verify(actionItemRepository, never()).saveAll(anyList());
        verify(actionItemRepository, never()).deleteByProcessingJobId(jobId);
    }

    @Test
    void repeatedActionPersistenceKeepsExistingIdAndUserFields() throws Exception {
        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        Job job = Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING).build();
        AIResponse response = createResponse(jobId, meetingId, """
                {"executiveSummary":"Meeting summary","actionItems":[{
                  "taskName":"Follow up","assigneeName":"AI name","status":"OPEN",
                  "sourceRefs":["TRANSCRIPT:11111111-1111-4111-8111-111111111111"]}]}
                """);
        ActionItem existing = new ActionItem();
        UUID existingId = UUID.randomUUID();
        existing.setId(existingId);
        existing.setMeetingId(meetingId);
        existing.setProcessingJobId(jobId);
        existing.setTaskName("Follow up");
        existing.setAssigneeName("User edited name");
        existing.setStatus("DONE");
        existing.setVerified(true);
        existing.setSourceRefs(List.of("TRANSCRIPT:11111111-1111-4111-8111-111111111111"));
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(summaryRepository.findByProcessingJobId(jobId)).thenReturn(Optional.empty());
        when(actionItemRepository.findByProcessingJobId(jobId)).thenReturn(List.of(existing));

        service.saveAIResult(response);

        assertEquals(existingId, existing.getId());
        assertEquals("User edited name", existing.getAssigneeName());
        assertEquals("DONE", existing.getStatus());
        assertTrue(existing.isVerified());
        verify(actionItemRepository, never()).saveAll(anyList());
        verify(actionItemRepository, never()).deleteByProcessingJobId(jobId);
    }
}
