package com.example.smartrec.service.impl;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import com.example.smartrec.service.GeminiFallbackPolicy;

public class DenyAllGeminiFallbackPolicy implements GeminiFallbackPolicy {
    @Override
    public Optional<AuthorizedPrompt> authorizeAndRedact(
            UUID jobId,
            UUID meetingId,
            UUID requestId,
            String systemPrompt,
            String prompt,
            int maxAttempts,
            int maxOutputTokens,
            int maxRequestsPerJob,
            BigDecimal maxCostPerJobUsd) {
        return Optional.empty();
    }
}
