package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.example.smartrec.config.AIModelRouterProperties;
import com.example.smartrec.service.GeminiFallbackPolicy.AuthorizedPrompt;
import com.example.smartrec.service.impl.GeminiFallbackClient;
import com.example.smartrec.service.impl.GeminiFallbackClient.GeminiGeneration;
import com.example.smartrec.service.impl.GeminiFallbackService;

@ExtendWith(MockitoExtension.class)
class GeminiFallbackServiceTest {
    @Mock
    private AIModelRouterProperties properties;
    @Mock
    private GeminiFallbackPolicy policy;
    @Mock
    private GeminiFallbackClient client;
    @InjectMocks
    private GeminiFallbackService service;

    @Test
    void fallbackIsDeniedWhenSharingGateIsClosed() {
        when(properties.isGeminiFallbackEnabled()).thenReturn(false);

        GeminiFallbackService.GeminiFallbackDeniedException error = assertThrows(
                GeminiFallbackService.GeminiFallbackDeniedException.class,
                () -> service.generate(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "system", "prompt"));

        assertEquals("GEMINI_FALLBACK_NOT_CONFIGURED", error.getMessage());
        verify(policy, never()).authorizeAndRedact(any(), any(), any(), any(), any(), anyInt(),
                anyInt(), anyInt(), any(BigDecimal.class));
        verify(client, never()).generate(any(), any(), anyInt());
    }

    @Test
    void enabledFallbackWithoutDataSharingApprovalNeverReachesPolicy() {
        when(properties.isGeminiFallbackEnabled()).thenReturn(true);
        when(properties.isGeminiDataSharingApproved()).thenReturn(false);

        var error = assertThrows(GeminiFallbackService.GeminiFallbackDeniedException.class,
                () -> service.generate(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                        "system", "confidential meeting prompt"));

        assertEquals("GEMINI_FALLBACK_NOT_CONFIGURED", error.getMessage());
        verify(policy, never()).authorizeAndRedact(any(), any(), any(), any(), any(), anyInt(),
                anyInt(), anyInt(), any(BigDecimal.class));
        verify(client, never()).generate(any(), any(), anyInt());
    }

    @Test
    void enabledFallbackRequiresPolicyRedactionBeforeProviderCall() {
        UUID jobId = UUID.randomUUID();
        UUID meetingId = UUID.randomUUID();
        UUID requestId = UUID.randomUUID();
        when(properties.isGeminiFallbackEnabled()).thenReturn(true);
        when(properties.isGeminiDataSharingApproved()).thenReturn(true);
        when(properties.getGeminiRedactionPolicyVersion()).thenReturn("approved-policy");
        when(properties.getGeminiApiKey()).thenReturn("mock-api-key");
        when(properties.getGeminiModel()).thenReturn("mock-model");
        when(properties.getGeminiMaxRequestsPerJob()).thenReturn(1);
        when(properties.getGeminiMaxCostPerJobUsd()).thenReturn(BigDecimal.ONE);
        when(properties.getGeminiMaxOutputTokens()).thenReturn(512);
        when(properties.getGeminiMaxAttempts()).thenReturn(1);
        when(policy.authorizeAndRedact(jobId, meetingId, requestId, "system", "prompt",
                1, 512, 1, BigDecimal.ONE))
                .thenReturn(Optional.of(new AuthorizedPrompt("redacted system", "redacted prompt")));
        GeminiGeneration generated = new GeminiGeneration("{}", 8L, 4L);
        when(client.generate("redacted system", "redacted prompt", 512)).thenReturn(generated);

        GeminiGeneration result = service.generate(jobId, meetingId, requestId, "system", "prompt");

        assertEquals(generated, result);
        verify(policy).authorizeAndRedact(jobId, meetingId, requestId, "system", "prompt",
                1, 512, 1, BigDecimal.ONE);
        verify(client).generate("redacted system", "redacted prompt", 512);
    }

    @Test
    void missingKeyOrCostBudgetDeniesBeforePolicyOrProvider() {
        org.mockito.Mockito.lenient().when(properties.isGeminiFallbackEnabled()).thenReturn(true);
        org.mockito.Mockito.lenient().when(properties.isGeminiDataSharingApproved()).thenReturn(true);
        org.mockito.Mockito.lenient().when(properties.getGeminiRedactionPolicyVersion())
                .thenReturn("contact-details-v1");
        org.mockito.Mockito.lenient().when(properties.getGeminiModel()).thenReturn("test-model");
        org.mockito.Mockito.lenient().when(properties.getGeminiMaxRequestsPerJob()).thenReturn(1);
        org.mockito.Mockito.lenient().when(properties.getGeminiMaxOutputTokens()).thenReturn(512);
        org.mockito.Mockito.lenient().when(properties.getGeminiMaxCostPerJobUsd())
                .thenReturn(BigDecimal.ONE);
        UUID id = UUID.randomUUID();

        var missingKey = assertThrows(GeminiFallbackService.GeminiFallbackDeniedException.class,
                () -> service.generate(id, id, id, "system", "prompt"));
        assertEquals("GEMINI_FALLBACK_NOT_CONFIGURED", missingKey.getMessage());

        when(properties.getGeminiApiKey()).thenReturn("test-key");
        when(properties.getGeminiMaxCostPerJobUsd()).thenReturn(BigDecimal.ZERO);
        var missingBudget = assertThrows(GeminiFallbackService.GeminiFallbackDeniedException.class,
                () -> service.generate(id, id, id, "system", "prompt"));
        assertEquals("GEMINI_FALLBACK_NOT_CONFIGURED", missingBudget.getMessage());
        verify(policy, never()).authorizeAndRedact(any(), any(), any(), any(), any(), anyInt(),
                anyInt(), anyInt(), any(BigDecimal.class));
        verify(client, never()).generate(any(), any(), anyInt());
    }

    @Test
    void requestBudgetLimitsProviderRetries() {
        UUID id = UUID.randomUUID();
        when(properties.isGeminiFallbackEnabled()).thenReturn(true);
        when(properties.isGeminiDataSharingApproved()).thenReturn(true);
        when(properties.getGeminiRedactionPolicyVersion()).thenReturn("contact-details-v1");
        when(properties.getGeminiApiKey()).thenReturn("test-key");
        when(properties.getGeminiModel()).thenReturn("test-model");
        when(properties.getGeminiMaxRequestsPerJob()).thenReturn(1);
        when(properties.getGeminiMaxCostPerJobUsd()).thenReturn(BigDecimal.ONE);
        when(properties.getGeminiMaxOutputTokens()).thenReturn(512);
        when(properties.getGeminiMaxAttempts()).thenReturn(2);
        when(policy.authorizeAndRedact(id, id, id, "system", "prompt", 1, 512, 1, BigDecimal.ONE))
                .thenReturn(Optional.of(new AuthorizedPrompt("safe system", "safe prompt")));
        when(client.generate("safe system", "safe prompt", 512))
                .thenThrow(new GeminiFallbackClient.GeminiProviderException(
                        "GEMINI_TIMEOUT_OR_CONNECTION_FAILURE", true));

        assertThrows(GeminiFallbackClient.GeminiProviderException.class,
                () -> service.generate(id, id, id, "system", "prompt"));
        verify(client).generate("safe system", "safe prompt", 512);
    }

    @Test
    void retryableRateLimitCanRetryOnlyWithinConfiguredRequestBudget() {
        UUID id = UUID.randomUUID();
        when(properties.isGeminiFallbackEnabled()).thenReturn(true);
        when(properties.isGeminiDataSharingApproved()).thenReturn(true);
        when(properties.getGeminiRedactionPolicyVersion()).thenReturn("contact-details-v1");
        when(properties.getGeminiApiKey()).thenReturn("test-key");
        when(properties.getGeminiModel()).thenReturn("test-model");
        when(properties.getGeminiMaxRequestsPerJob()).thenReturn(2);
        when(properties.getGeminiMaxCostPerJobUsd()).thenReturn(BigDecimal.ONE);
        when(properties.getGeminiMaxOutputTokens()).thenReturn(512);
        when(properties.getGeminiMaxAttempts()).thenReturn(5);
        when(policy.authorizeAndRedact(id, id, id, "system", "prompt", 2, 512, 2, BigDecimal.ONE))
                .thenReturn(Optional.of(new AuthorizedPrompt("safe system", "safe prompt")));
        when(client.generate("safe system", "safe prompt", 512))
                .thenThrow(new GeminiFallbackClient.GeminiProviderException("GEMINI_RATE_LIMITED", true))
                .thenReturn(new GeminiGeneration("{}", 8L, 4L));

        GeminiGeneration result = service.generate(id, id, id, "system", "prompt");

        assertEquals("{}", result.text());
        verify(client, times(2)).generate("safe system", "safe prompt", 512);
        verify(policy).authorizeAndRedact(id, id, id, "system", "prompt", 2, 512, 2, BigDecimal.ONE);
    }

    @Test
    void quotaFailureIsNotRetriedEvenWhenBudgetAllowsTwoRequests() {
        UUID id = UUID.randomUUID();
        when(properties.isGeminiFallbackEnabled()).thenReturn(true);
        when(properties.isGeminiDataSharingApproved()).thenReturn(true);
        when(properties.getGeminiRedactionPolicyVersion()).thenReturn("contact-details-v1");
        when(properties.getGeminiApiKey()).thenReturn("test-key");
        when(properties.getGeminiModel()).thenReturn("test-model");
        when(properties.getGeminiMaxRequestsPerJob()).thenReturn(2);
        when(properties.getGeminiMaxCostPerJobUsd()).thenReturn(BigDecimal.ONE);
        when(properties.getGeminiMaxOutputTokens()).thenReturn(512);
        when(properties.getGeminiMaxAttempts()).thenReturn(2);
        when(policy.authorizeAndRedact(id, id, id, "system", "prompt", 2, 512, 2, BigDecimal.ONE))
                .thenReturn(Optional.of(new AuthorizedPrompt("safe system", "safe prompt")));
        when(client.generate("safe system", "safe prompt", 512))
                .thenThrow(new GeminiFallbackClient.GeminiProviderException("GEMINI_QUOTA_EXCEEDED", false));

        var error = assertThrows(GeminiFallbackClient.GeminiProviderException.class,
                () -> service.generate(id, id, id, "system", "prompt"));

        assertEquals("GEMINI_QUOTA_EXCEEDED", error.getCode());
        verify(client).generate("safe system", "safe prompt", 512);
    }
}
