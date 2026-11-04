package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.never;
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
}
