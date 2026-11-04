package com.example.smartrec.service.impl;

import java.math.BigDecimal;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.example.smartrec.config.AIModelRouterProperties;
import com.example.smartrec.service.GeminiFallbackPolicy;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class GeminiFallbackService {
    private final AIModelRouterProperties properties;
    private final GeminiFallbackPolicy policy;
    private final GeminiFallbackClient client;

    public GeminiFallbackClient.GeminiGeneration generate(
            UUID jobId,
            UUID meetingId,
            UUID requestId,
            String systemPrompt,
            String prompt) {
        if (!properties.isGeminiFallbackEnabled()
                || !properties.isGeminiDataSharingApproved()
                || properties.getGeminiRedactionPolicyVersion() == null
                || properties.getGeminiRedactionPolicyVersion().isBlank()
                || properties.getGeminiApiKey() == null
                || properties.getGeminiApiKey().isBlank()
                || properties.getGeminiModel() == null
                || properties.getGeminiModel().isBlank()
                || properties.getGeminiMaxRequestsPerJob() <= 0
                || properties.getGeminiMaxCostPerJobUsd() == null
                || properties.getGeminiMaxCostPerJobUsd().compareTo(BigDecimal.ZERO) <= 0
                || properties.getGeminiMaxOutputTokens() <= 0) {
            throw new GeminiFallbackDeniedException("GEMINI_FALLBACK_NOT_CONFIGURED");
        }

        var authorized = policy.authorizeAndRedact(
                jobId,
                meetingId,
                requestId,
                systemPrompt,
                prompt,
                Math.max(1, Math.min(properties.getGeminiMaxAttempts(), 2)),
                properties.getGeminiMaxOutputTokens(),
                properties.getGeminiMaxRequestsPerJob(),
                properties.getGeminiMaxCostPerJobUsd());
        if (authorized.isEmpty()) {
            throw new GeminiFallbackDeniedException("GEMINI_DATA_POLICY_DENIED");
        }

        int maxAttempts = Math.max(1, Math.min(properties.getGeminiMaxAttempts(), 2));
        GeminiFallbackClient.GeminiProviderException lastFailure = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return client.generate(
                        authorized.get().systemPrompt(),
                        authorized.get().prompt(),
                        properties.getGeminiMaxOutputTokens());
            } catch (GeminiFallbackClient.GeminiProviderException ex) {
                lastFailure = ex;
                if (!ex.isRetryable() || attempt == maxAttempts) {
                    throw ex;
                }
            }
        }
        throw lastFailure == null
                ? new GeminiFallbackDeniedException("GEMINI_FALLBACK_NOT_AVAILABLE")
                : lastFailure;
    }

    public static class GeminiFallbackDeniedException extends RuntimeException {
        public GeminiFallbackDeniedException(String code) {
            super(code);
        }
    }
}
