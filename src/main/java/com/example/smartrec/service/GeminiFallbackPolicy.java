package com.example.smartrec.service;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

public interface GeminiFallbackPolicy {
    Optional<AuthorizedPrompt> authorizeAndRedact(
            UUID jobId,
            UUID meetingId,
            UUID requestId,
            String systemPrompt,
            String prompt,
            int maxAttempts,
            int maxOutputTokens,
            int maxRequestsPerJob,
            BigDecimal maxCostPerJobUsd);

    record AuthorizedPrompt(String systemPrompt, String prompt) {}
}
