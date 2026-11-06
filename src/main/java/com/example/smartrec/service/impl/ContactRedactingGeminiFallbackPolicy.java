package com.example.smartrec.service.impl;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import com.example.smartrec.service.GeminiFallbackPolicy;

/** Redacts incidental contact details without changing names, dates or citation IDs. */
public final class ContactRedactingGeminiFallbackPolicy implements GeminiFallbackPolicy {
    private static final Pattern EMAIL = Pattern.compile(
            "(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}");
    private static final Pattern URL = Pattern.compile(
            "(?i)https?://[^\\s\\\"<>]+");
    private static final Pattern PHONE = Pattern.compile(
            "(?<![\\w-])(?:\\+84|0)(?:[ .()]?\\d){8,10}(?![\\w-])");

    @Override
    public Optional<AuthorizedPrompt> authorizeAndRedact(
            UUID jobId, UUID meetingId, UUID requestId,
            String systemPrompt, String prompt, int maxAttempts,
            int maxOutputTokens, int maxRequestsPerJob, BigDecimal maxCostPerJobUsd) {
        if (jobId == null || meetingId == null || requestId == null
                || systemPrompt == null || systemPrompt.isBlank()
                || prompt == null || prompt.isBlank()
                || maxAttempts <= 0 || maxAttempts > 2
                || maxRequestsPerJob <= 0 || maxAttempts > maxRequestsPerJob
                || maxOutputTokens <= 0 || maxCostPerJobUsd == null
                || maxCostPerJobUsd.compareTo(BigDecimal.ZERO) <= 0) {
            return Optional.empty();
        }
        return Optional.of(new AuthorizedPrompt(redact(systemPrompt), redact(prompt)));
    }

    private static String redact(String value) {
        return PHONE.matcher(URL.matcher(EMAIL.matcher(value)
                .replaceAll("[REDACTED_EMAIL]"))
                .replaceAll("[REDACTED_URL]"))
                .replaceAll("[REDACTED_PHONE]");
    }
}
