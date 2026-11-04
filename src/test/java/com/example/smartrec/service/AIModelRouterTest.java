package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import com.example.smartrec.config.AIEngineConfig;
import com.example.smartrec.config.AIModelRouterProperties;
import com.example.smartrec.entity.Job;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.model.dto.InternalLLMContracts;
import com.example.smartrec.model.dto.JobContext;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.service.impl.AIModelRouter;
import com.example.smartrec.service.impl.GeminiFallbackService;
import com.fasterxml.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class AIModelRouterTest {
    private static final UUID JOB_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID MEETING_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID EXECUTION_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID TRANSCRIPT_ID = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final String SOURCE_REF = "TRANSCRIPT:" + TRANSCRIPT_ID;

    @Mock
    private AIEngineConfig aiEngineConfig;
    @Mock
    private AIModelRouterProperties properties;
    @Mock
    private JobRepository jobRepository;
    @Mock
    private ContextPayloadService contextPayloadService;
    @Mock
    private LocalLLMAdapterClient localClient;
    @Mock
    private GeminiFallbackService geminiFallbackService;
    @Mock
    private AIResponseValidator responseValidator;
    @Spy
    private ObjectMapper objectMapper = new ObjectMapper();
    @InjectMocks
    private AIModelRouter router;

    private void stubLiveJobContextAndPreparation() {
        when(properties.getLocalMaxAttempts()).thenReturn(1);
        when(jobRepository.findById(JOB_ID)).thenReturn(Optional.of(liveJob()));
        when(contextPayloadService.createJobContext(MEETING_ID, JOB_ID, true))
                .thenReturn(new JobContext(MEETING_ID, JOB_ID, List.of(
                        new JobContext.Evidence("TRANSCRIPT", TRANSCRIPT_ID,
                                UUID.randomUUID(), 1000L, 2000L, "Discuss the launch plan."))));
        when(localClient.prepare(any())).thenReturn(new InternalLLMContracts.PrepareResponse(
                InternalLLMContracts.VERSION,
                stableRequestId(),
                JOB_ID,
                MEETING_ID,
                "MEETING_ANALYSIS",
                "system prompt",
                "user prompt",
                List.of(SOURCE_REF),
                InternalLLMContracts.SUMMARY_SCHEMA_VERSION));
    }

    @Test
    void localPrimaryResultIsValidatedAndMapsRelativeDeadlineWithoutInventingDate() throws Exception {
        stubLiveJobContextAndPreparation();
        var summary = objectMapper.readTree("""
                {
                  "schema_version": "smartrec.ai.meeting-summary.v1",
                  "executive_summary": "Discussed the launch plan.",
                  "executive_summary_refs": ["TRANSCRIPT:44444444-4444-4444-8444-444444444444"],
                  "key_points": [],
                  "decisions": [],
                  "action_items": [{
                    "title": "Share the revised launch plan",
                    "assignee": null,
                    "deadline": "next Tuesday",
                    "deadline_raw": null,
                    "source_refs": ["TRANSCRIPT:44444444-4444-4444-8444-444444444444"]
                  }],
                  "open_issues": [],
                  "next_steps": [],
                  "conflicts": []
                }
                """);
        when(localClient.generate(any())).thenReturn(new InternalLLMContracts.GenerateResponse(
                InternalLLMContracts.VERSION,
                stableRequestId(),
                JOB_ID,
                MEETING_ID,
                "MEETING_ANALYSIS",
                "LOCAL",
                "qwen2.5:3b-instruct-q4_K_M",
                "SUCCESS",
                summary,
                new InternalLLMContracts.TokenMetadata(10L, 20L, 30L, "ollama_metadata"),
                250L));

        AIResponse response = router.generate(JOB_ID, EXECUTION_ID);

        assertEquals("LOCAL", response.getProvider());
        assertEquals(stableRequestId(), response.getRequestId());
        assertEquals("ollama_metadata", response.getTokenSource());
        assertEquals("SUCCESS", response.getStatus());
        assertEquals("Discussed the launch plan.", response.getResult().path("executiveSummary").asText());
        assertEquals("Share the revised launch plan",
                response.getResult().path("actionItems").path(0).path("taskName").asText());
        assertNull(response.getResult().path("actionItems").path(0).path("dueDate").textValue());
        assertEquals("next Tuesday",
                response.getResult().path("actionItems").path(0).path("deadlineRaw").asText());
        assertEquals(SOURCE_REF,
                response.getResult().path("actionItems").path(0).path("sourceRefs").path(0).asText());
        assertEquals(summary, response.getResult().path("meetingSummary"));
        verify(responseValidator).validate(response);
        verify(geminiFallbackService, never()).generate(any(), any(), any(), any(), any());
    }

    @Test
    void staleExecutionIsRejectedBeforeContextOrInference() {
        when(jobRepository.findById(JOB_ID)).thenReturn(Optional.of(Job.builder()
                .id(JOB_ID)
                .meetingId(MEETING_ID)
                .status(JobStatus.FAILED)
                .executionId(EXECUTION_ID)
                .leaseExpiresAt(Instant.now().plusSeconds(60))
                .build()));

        BusinessException error = assertThrows(
                BusinessException.class,
                () -> router.generate(JOB_ID, EXECUTION_ID));

        assertEquals(HttpStatus.CONFLICT, error.getStatus());
        assertEquals("STALE_EXECUTION_CALLBACK", error.getCode());
        verify(contextPayloadService, never()).createJobContext(any(), any(), anyBoolean());
        verify(localClient, never()).prepare(any());
        verify(localClient, never()).generate(any());
    }

    @Test
    void disabledGeminiFallbackCannotProduceAnUnvalidatedResult() {
        stubLiveJobContextAndPreparation();
        when(localClient.generate(any())).thenThrow(
                new LocalLLMAdapterClient.AdapterException("LOCAL_MODEL_TIMEOUT", true));
        when(geminiFallbackService.generate(any(), any(), any(), any(), any()))
                .thenThrow(new GeminiFallbackService.GeminiFallbackDeniedException(
                        "GEMINI_FALLBACK_NOT_CONFIGURED"));

        BusinessException error = assertThrows(
                BusinessException.class,
                () -> router.generate(JOB_ID, EXECUTION_ID));

        assertEquals("GEMINI_FALLBACK_DENIED", error.getCode());
        verify(localClient, never()).validateFallback(any());
    }

    @Test
    void localInferenceRetriesAreBoundedAndReuseLogicalRequestId() {
        stubLiveJobContextAndPreparation();
        when(properties.getLocalMaxAttempts()).thenReturn(3);
        when(properties.getLocalCircuitFailureThreshold()).thenReturn(5);
        when(localClient.generate(any())).thenThrow(
                new LocalLLMAdapterClient.AdapterException("LOCAL_MODEL_TIMEOUT", true));
        when(geminiFallbackService.generate(any(), any(), any(), any(), any()))
                .thenThrow(new GeminiFallbackService.GeminiFallbackDeniedException(
                        "GEMINI_FALLBACK_NOT_CONFIGURED"));

        assertThrows(BusinessException.class, () -> router.generate(JOB_ID, EXECUTION_ID));

        var requests = org.mockito.ArgumentCaptor.forClass(InternalLLMContracts.GenerateRequest.class);
        verify(localClient, org.mockito.Mockito.times(3)).generate(requests.capture());
        assertEquals(
                List.of(stableRequestId(), stableRequestId(), stableRequestId()),
                requests.getAllValues().stream()
                        .map(InternalLLMContracts.GenerateRequest::requestId)
                        .toList());
    }

    @Test
    void fallbackRetryCountReflectsLocalAttemptsActuallyExecuted() throws Exception {
        stubLiveJobContextAndPreparation();
        when(properties.getLocalMaxAttempts()).thenReturn(3);
        when(properties.getLocalCircuitFailureThreshold()).thenReturn(2);
        when(properties.getLocalCircuitOpenMs()).thenReturn(30_000L);
        when(properties.getLocalRetryBackoffMs()).thenReturn(0L);
        when(properties.getGeminiModel()).thenReturn("mock-gemini");
        when(localClient.generate(any())).thenThrow(
                new LocalLLMAdapterClient.AdapterException("LOCAL_MODEL_TIMEOUT", true));
        when(geminiFallbackService.generate(any(), any(), any(), any(), any()))
                .thenReturn(new com.example.smartrec.service.impl.GeminiFallbackClient.GeminiGeneration(
                        "mocked fallback output", 1L, 2L));
        var summary = objectMapper.readTree("""
                {
                  "schema_version": "smartrec.ai.meeting-summary.v1",
                  "executive_summary": "Discussed the launch plan.",
                  "executive_summary_refs": ["TRANSCRIPT:44444444-4444-4444-8444-444444444444"],
                  "key_points": [],
                  "decisions": [],
                  "action_items": [],
                  "open_issues": [],
                  "next_steps": [],
                  "conflicts": []
                }
                """);
        when(localClient.validateFallback(any())).thenReturn(new InternalLLMContracts.ValidateResponse(
                InternalLLMContracts.VERSION,
                stableRequestId(),
                JOB_ID,
                MEETING_ID,
                "MEETING_ANALYSIS",
                summary));

        AIResponse response = router.generate(JOB_ID, EXECUTION_ID);

        assertEquals("GEMINI", response.getProvider());
        assertEquals(1, response.getRetryCount());
        verify(localClient, org.mockito.Mockito.times(2)).generate(any());
    }

    @Test
    void leaseLostAfterInferencePreventsResultValidationAndPublication() throws Exception {
        stubLiveJobContextAndPreparation();
        Job staleJob = Job.builder()
                .id(JOB_ID)
                .meetingId(MEETING_ID)
                .status(JobStatus.FAILED)
                .executionId(EXECUTION_ID)
                .leaseExpiresAt(Instant.now().minusSeconds(1))
                .build();
        when(jobRepository.findById(JOB_ID)).thenReturn(
                Optional.of(liveJob()),
                Optional.of(liveJob()),
                Optional.of(liveJob()),
                Optional.of(staleJob));
        var summary = objectMapper.readTree("""
                {
                  "schema_version": "smartrec.ai.meeting-summary.v1",
                  "executive_summary": "Discussed the launch plan.",
                  "executive_summary_refs": ["TRANSCRIPT:44444444-4444-4444-8444-444444444444"],
                  "key_points": [],
                  "decisions": [],
                  "action_items": [],
                  "open_issues": [],
                  "next_steps": [],
                  "conflicts": []
                }
                """);
        when(localClient.generate(any())).thenReturn(new InternalLLMContracts.GenerateResponse(
                InternalLLMContracts.VERSION, stableRequestId(), JOB_ID, MEETING_ID, "MEETING_ANALYSIS",
                "LOCAL", "qwen2.5:3b", "SUCCESS", summary,
                new InternalLLMContracts.TokenMetadata(1L, 1L, 2L, "ollama_metadata"), 1L));

        BusinessException error = assertThrows(
                BusinessException.class, () -> router.generate(JOB_ID, EXECUTION_ID));

        assertEquals("STALE_EXECUTION_CALLBACK", error.getCode());
        verify(responseValidator, never()).validate(any());
        verify(geminiFallbackService, never()).generate(any(), any(), any(), any(), any());
    }

    private Job liveJob() {
        return Job.builder()
                .id(JOB_ID)
                .meetingId(MEETING_ID)
                .status(JobStatus.PROCESSING)
                .executionId(EXECUTION_ID)
                .leaseExpiresAt(Instant.now().plusSeconds(60))
                .build();
    }

    private UUID stableRequestId() {
        return UUID.nameUUIDFromBytes(
                ("smartrec-ai-inference-v1:" + JOB_ID + ":MEETING_ANALYSIS")
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
