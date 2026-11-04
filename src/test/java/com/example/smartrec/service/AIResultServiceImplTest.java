package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.model.dto.AiUsageRequest;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.SummaryRepository;
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
                      "status": "OPEN"
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

        verify(actionItemRepository)
                .deleteByProcessingJobId(jobId);

        verify(actionItemRepository)
                .saveAll(anyList());

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
}
