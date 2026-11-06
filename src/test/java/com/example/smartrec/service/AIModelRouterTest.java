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
import java.time.Clock;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import com.example.smartrec.config.AIEngineConfig;
import com.example.smartrec.config.AIModelRouterProperties;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.model.dto.InternalLLMContracts;
import com.example.smartrec.model.dto.JobContext;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobRepository.ExecutionLeaseView;
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
        ExecutionLeaseView currentLease = liveLease();
        when(jobRepository.findExecutionLeaseById(JOB_ID)).thenReturn(Optional.of(currentLease));
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
                List.of("S1"),
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
        var request = org.mockito.ArgumentCaptor.forClass(InternalLLMContracts.GenerateRequest.class);
        verify(localClient).generate(request.capture());
        assertEquals(List.of("S1"), request.getValue().allowedSourceRefs());
        verify(responseValidator).validate(response);
        verify(geminiFallbackService, never()).generate(any(), any(), any(), any(), any());
    }

    @Test
    void staleExecutionIsRejectedBeforeContextOrInference() {
        ExecutionLeaseView failedLease = lease(JobStatus.FAILED, Instant.now().plusSeconds(60), EXECUTION_ID);
        when(jobRepository.findExecutionLeaseById(JOB_ID)).thenReturn(Optional.of(
                failedLease));

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
    void evidenceConsistencyFailureDoesNotTriggerGeminiFallback() {
        stubLiveJobContextAndPreparation();
        when(localClient.generate(any())).thenThrow(
                new LocalLLMAdapterClient.AdapterException("EVIDENCE_CONSISTENCY_ERROR", false));

        BusinessException error = assertThrows(
                BusinessException.class,
                () -> router.generate(JOB_ID, EXECUTION_ID));

        assertEquals("AI_LOCAL_INFERENCE_FAILED", error.getCode());
        verify(geminiFallbackService, never()).generate(any(), any(), any(), any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"LOCAL_MODEL_TIMEOUT", "LOCAL_MODEL_TRUNCATED"})
    void deterministicInferenceFailureSkipsUnchangedRetryAndReusesLogicalRequestId(String errorCode) {
        stubLiveJobContextAndPreparation();
        when(properties.getLocalMaxAttempts()).thenReturn(3);
        when(properties.getLocalCircuitFailureThreshold()).thenReturn(5);
        when(localClient.generate(any())).thenThrow(
                new LocalLLMAdapterClient.AdapterException(errorCode, true));
        when(geminiFallbackService.generate(any(), any(), any(), any(), any()))
                .thenThrow(new GeminiFallbackService.GeminiFallbackDeniedException(
                        "GEMINI_FALLBACK_NOT_CONFIGURED"));

        assertThrows(BusinessException.class, () -> router.generate(JOB_ID, EXECUTION_ID));

        var requests = org.mockito.ArgumentCaptor.forClass(InternalLLMContracts.GenerateRequest.class);
        verify(localClient, org.mockito.Mockito.times(1)).generate(requests.capture());
        assertEquals(
                List.of(stableRequestId()),
                requests.getAllValues().stream()
                        .map(InternalLLMContracts.GenerateRequest::requestId)
                        .toList());
        assertEquals(1, requests.getValue().evidence().size());
        assertEquals(SOURCE_REF, "TRANSCRIPT:" + requests.getValue().evidence().get(0).sourceId());
    }

    @Test
    void fallbackRetryCountReflectsSingleTimedOutAttempt() throws Exception {
        stubLiveJobContextAndPreparation();
        when(properties.getLocalMaxAttempts()).thenReturn(3);
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
        assertEquals(0, response.getRetryCount());
        verify(localClient, org.mockito.Mockito.times(1)).generate(any());
    }

    @Test
    void leaseLostAfterInferencePreventsResultValidationAndPublication() throws Exception {
        stubLiveJobContextAndPreparation();
        ExecutionLeaseView firstLease = liveLease();
        ExecutionLeaseView secondLease = liveLease();
        ExecutionLeaseView thirdLease = liveLease();
        ExecutionLeaseView expiredLease = lease(JobStatus.FAILED, Instant.now().minusSeconds(1), EXECUTION_ID);
        when(jobRepository.findExecutionLeaseById(JOB_ID)).thenReturn(
                Optional.of(firstLease), Optional.of(secondLease), Optional.of(thirdLease), Optional.of(expiredLease));
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

    @Test
    void renewedLeaseIsReadAgainAfterInferenceAndAccepted() throws Exception {
        Instant startedAt = Instant.parse("2026-11-05T10:00:00Z");
        MutableClock clock = new MutableClock(startedAt);
        org.springframework.test.util.ReflectionTestUtils.setField(router, "clock", clock);
        stubLiveJobContextAndPreparation();
        Instant originalExpiry = startedAt.plusSeconds(90);
        ExecutionLeaseView firstLease = lease(JobStatus.PROCESSING, originalExpiry, EXECUTION_ID);
        ExecutionLeaseView secondLease = lease(JobStatus.PROCESSING, originalExpiry, EXECUTION_ID);
        ExecutionLeaseView thirdLease = lease(JobStatus.PROCESSING, originalExpiry, EXECUTION_ID);
        ExecutionLeaseView renewedLease = lease(JobStatus.PROCESSING, startedAt.plusSeconds(180), EXECUTION_ID);
        when(jobRepository.findExecutionLeaseById(JOB_ID)).thenReturn(
                Optional.of(firstLease), Optional.of(secondLease), Optional.of(thirdLease), Optional.of(renewedLease));
        InternalLLMContracts.GenerateResponse generated = successfulGeneration();
        when(localClient.generate(any())).thenAnswer(invocation -> {
            clock.advanceSeconds(91);
            return generated;
        });

        AIResponse response = router.generate(JOB_ID, EXECUTION_ID);

        assertEquals("SUCCESS", response.getStatus());
        verify(jobRepository, org.mockito.Mockito.times(4)).findExecutionLeaseById(JOB_ID);
        verify(responseValidator).validate(response);
    }

    @Test
    void inferencePastNinetySecondLeaseWithoutHeartbeatIsRejected() throws Exception {
        Instant startedAt = Instant.parse("2026-11-05T10:00:00Z");
        MutableClock clock = new MutableClock(startedAt);
        org.springframework.test.util.ReflectionTestUtils.setField(router, "clock", clock);
        stubLiveJobContextAndPreparation();
        Instant originalExpiry = startedAt.plusSeconds(90);
        ExecutionLeaseView firstLease = lease(JobStatus.PROCESSING, originalExpiry, EXECUTION_ID);
        ExecutionLeaseView secondLease = lease(JobStatus.PROCESSING, originalExpiry, EXECUTION_ID);
        ExecutionLeaseView thirdLease = lease(JobStatus.PROCESSING, originalExpiry, EXECUTION_ID);
        ExecutionLeaseView expiredLease = lease(JobStatus.PROCESSING, originalExpiry, EXECUTION_ID);
        when(jobRepository.findExecutionLeaseById(JOB_ID)).thenReturn(
                Optional.of(firstLease), Optional.of(secondLease), Optional.of(thirdLease), Optional.of(expiredLease));
        InternalLLMContracts.GenerateResponse generated = successfulGeneration();
        when(localClient.generate(any())).thenAnswer(invocation -> {
            clock.advanceSeconds(91);
            return generated;
        });

        BusinessException error = assertThrows(
                BusinessException.class, () -> router.generate(JOB_ID, EXECUTION_ID));

        assertEquals("STALE_EXECUTION_CALLBACK", error.getCode());
        verify(responseValidator, never()).validate(any());
    }

    @Test
    void replacedExecutionIsRejectedAfterInference() throws Exception {
        assertRejectedAfterInference(lease(JobStatus.PROCESSING, Instant.now().plusSeconds(60), UUID.randomUUID()));
    }

    @Test
    void terminalJobIsRejectedAfterInference() throws Exception {
        assertRejectedAfterInference(lease(JobStatus.COMPLETED, Instant.now().plusSeconds(60), EXECUTION_ID));
    }

    private void assertRejectedAfterInference(ExecutionLeaseView postInferenceLease) throws Exception {
        stubLiveJobContextAndPreparation();
        ExecutionLeaseView firstLease = liveLease();
        ExecutionLeaseView secondLease = liveLease();
        ExecutionLeaseView thirdLease = liveLease();
        when(jobRepository.findExecutionLeaseById(JOB_ID)).thenReturn(
                Optional.of(firstLease), Optional.of(secondLease), Optional.of(thirdLease), Optional.of(postInferenceLease));
        InternalLLMContracts.GenerateResponse generated = successfulGeneration();
        when(localClient.generate(any())).thenReturn(generated);

        BusinessException error = assertThrows(
                BusinessException.class, () -> router.generate(JOB_ID, EXECUTION_ID));

        assertEquals("STALE_EXECUTION_CALLBACK", error.getCode());
        verify(responseValidator, never()).validate(any());
    }

    private InternalLLMContracts.GenerateResponse successfulGeneration() throws Exception {
        var summary = objectMapper.readTree("""
                {"schema_version":"smartrec.ai.meeting-summary.v1",
                 "executive_summary":"Discussed the launch plan.",
                 "executive_summary_refs":["TRANSCRIPT:44444444-4444-4444-8444-444444444444"],
                 "key_points":[],"decisions":[],"action_items":[],"open_issues":[],
                 "next_steps":[],"conflicts":[]}
                """);
        return new InternalLLMContracts.GenerateResponse(
                InternalLLMContracts.VERSION, stableRequestId(), JOB_ID, MEETING_ID, "MEETING_ANALYSIS",
                "LOCAL", "qwen2.5:3b", "SUCCESS", summary,
                new InternalLLMContracts.TokenMetadata(1L, 1L, 2L, "ollama_metadata"), 1L);
    }

    private ExecutionLeaseView liveLease() {
        return lease(JobStatus.PROCESSING, Instant.now().plusSeconds(60), EXECUTION_ID);
    }

    private ExecutionLeaseView lease(JobStatus status, Instant expiresAt, UUID executionId) {
        ExecutionLeaseView lease = org.mockito.Mockito.mock(ExecutionLeaseView.class);
        org.mockito.Mockito.lenient().when(lease.getJobId()).thenReturn(JOB_ID);
        org.mockito.Mockito.lenient().when(lease.getMeetingId()).thenReturn(MEETING_ID);
        org.mockito.Mockito.lenient().when(lease.getExecutionId()).thenReturn(executionId);
        org.mockito.Mockito.lenient().when(lease.getLeaseExpiresAt()).thenReturn(expiresAt);
        org.mockito.Mockito.lenient().when(lease.getStatus()).thenReturn(status);
        return lease;
    }

    private UUID stableRequestId() {
        return UUID.nameUUIDFromBytes(
                ("smartrec-ai-inference-v1:" + JOB_ID + ":MEETING_ANALYSIS")
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private static final class MutableClock extends Clock {
        private final AtomicReference<Instant> instant;

        private MutableClock(Instant initial) {
            this.instant = new AtomicReference<>(initial);
        }

        private void advanceSeconds(long seconds) {
            instant.updateAndGet(value -> value.plusSeconds(seconds));
        }

        @Override public ZoneId getZone() { return ZoneId.of("UTC"); }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return instant.get(); }
    }
}
