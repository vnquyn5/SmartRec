package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import com.example.smartrec.config.AIEngineConfig;
import com.example.smartrec.config.AIModelRouterProperties;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.model.dto.JobContext;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.JobRepository.ExecutionLeaseView;
import com.example.smartrec.service.impl.AIModelRouter;
import com.example.smartrec.service.impl.AIResponseValidatorImpl;
import com.example.smartrec.service.impl.GeminiFallbackService;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Opt-in live boundary test: real router, Spring adapter, FastAPI and Ollama;
 * only the persisted Job/context fixture and disabled fallback are isolated.
 */
class AIModelRouterLiveIntegrationTest {
    private static final UUID JOB_ID = UUID.fromString("a1111111-1111-4111-8111-111111111111");
    private static final UUID MEETING_ID = UUID.fromString("a2222222-2222-4222-8222-222222222222");
    private static final UUID EXECUTION_ID = UUID.fromString("a3333333-3333-4333-8333-333333333333");
    private static final UUID TRANSCRIPT_ID = UUID.fromString("a4444444-4444-4444-8444-444444444444");

    @Test
    void routesVerifiedFixtureThroughFastApiAndLocalOllama() {
        String token = System.getenv("SMARTREC_INTERNAL_TOKEN");
        Assumptions.assumeTrue("true".equalsIgnoreCase(System.getenv("SMARTREC_LIVE_LLM_TEST"))
                        && token != null && !token.isBlank(),
                "Set SMARTREC_LIVE_LLM_TEST=true and SMARTREC_INTERNAL_TOKEN to run the live test");

        JobRepository jobs = mock(JobRepository.class);
        ExecutionLeaseView lease = mock(ExecutionLeaseView.class);
        when(lease.getJobId()).thenReturn(JOB_ID);
        when(lease.getMeetingId()).thenReturn(MEETING_ID);
        when(lease.getStatus()).thenReturn(JobStatus.PROCESSING);
        when(lease.getExecutionId()).thenReturn(EXECUTION_ID);
        when(lease.getLeaseExpiresAt()).thenReturn(Instant.now().plusSeconds(600));
        when(jobs.findExecutionLeaseById(JOB_ID)).thenReturn(Optional.of(lease));

        ContextPayloadService contexts = mock(ContextPayloadService.class);
        when(contexts.createJobContext(MEETING_ID, JOB_ID, true)).thenReturn(
                new JobContext(MEETING_ID, JOB_ID, List.of(new JobContext.Evidence(
                        "TRANSCRIPT", TRANSCRIPT_ID, null, 0L, 15000L,
                        "Nhóm thống nhất dùng PostgreSQL cho cơ sở dữ liệu. "
                                + "Minh sẽ chuẩn bị tài liệu thiết kế cơ sở dữ liệu trước thứ Sáu."))));

        AIEngineConfig engine = new AIEngineConfig();
        engine.setBaseUrl(System.getenv().getOrDefault("AI_ENGINE_BASE_URL", "http://127.0.0.1:8000"));
        engine.setPreparePath("/api/v1/internal/llm/prepare");
        engine.setGeneratePath("/api/v1/internal/llm/generate");
        engine.setValidatePath("/api/v1/internal/llm/validate");
        engine.setInternalToken(token);
        engine.setConnectTimeout(5000);
        engine.setReadTimeout(130000);

        AIModelRouterProperties properties = new AIModelRouterProperties();
        properties.setLocalMaxAttempts(1);
        GeminiFallbackService fallback = mock(GeminiFallbackService.class);
        org.mockito.Mockito.when(fallback.generate(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()))
                .thenAnswer(invocation -> {
                    throw new AssertionError(
                            "Unexpected Gemini fallback call during the local Ollama integration test");
                });
        AIModelRouter router = new AIModelRouter(
                properties,
                jobs,
                contexts,
                new LocalLLMAdapterClient(engine, engine.aiEngineRestTemplate(new org.springframework.boot.web.client.RestTemplateBuilder()),
                        new ObjectMapper()),
                fallback,
                new AIResponseValidatorImpl(),
                new ObjectMapper());

        var response = router.generate(JOB_ID, EXECUTION_ID);

        assertEquals("LOCAL", response.getProvider());
        assertEquals("qwen2.5:3b-instruct-q4_K_M", response.getModel());
        assertFalse(response.isFallbackUsed());
        assertTrue(response.getResult().path("executiveSummary").asText().length() > 0);
        assertEquals("ollama_metadata", response.getTokenSource());
        assertTrue(response.getInputTokens() != null && response.getOutputTokens() != null);
        assertTrue(response.getResult().path("meetingSummary").path("executive_summary_refs")
                .toString().contains("TRANSCRIPT:" + TRANSCRIPT_ID));
        verifyNoInteractions(fallback);
    }
}
