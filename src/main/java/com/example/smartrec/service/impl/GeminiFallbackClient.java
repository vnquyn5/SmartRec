
package com.example.smartrec.service.impl;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Locale;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import com.example.smartrec.config.AIModelRouterProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class GeminiFallbackClient {
    private static final Logger log = LoggerFactory.getLogger(GeminiFallbackClient.class);

    private final RestTemplate restTemplate;
    private final AIModelRouterProperties properties;
    private final ObjectMapper objectMapper;

    // Constructor production: Spring Boot dependency injection
    @Autowired
    public GeminiFallbackClient(
            RestTemplateBuilder builder,
            AIModelRouterProperties properties,
            ObjectMapper objectMapper) {

        this(builder
                .setConnectTimeout(
                        java.time.Duration.ofMillis(properties.getGeminiTimeoutMs()))
                .setReadTimeout(
                        java.time.Duration.ofMillis(properties.getGeminiTimeoutMs()))
                .build(), properties, objectMapper);
    }

    // Constructor dành cho unit test
    GeminiFallbackClient(
            RestTemplate restTemplate,
            AIModelRouterProperties properties,
            ObjectMapper objectMapper) {

        this.restTemplate = restTemplate;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    public GeminiGeneration generate(
            String systemPrompt,
            String prompt,
            int maxOutputTokens) {

        String base = "https://generativelanguage.googleapis.com/v1beta/models/";

        URI uri = URI.create(
                base + properties.getGeminiModel() + ":generateContent");

        Map<String, Object> body = Map.of(
                "systemInstruction",
                Map.of(
                        "parts",
                        List.of(Map.of("text", systemPrompt))
                ),
                "contents",
                List.of(
                        Map.of(
                                "role", "user",
                                "parts", List.of(Map.of("text", prompt))
                        )
                ),
                "generationConfig",
                Map.of(
                        "maxOutputTokens", maxOutputTokens,
                        "temperature", 0.1,
                        "responseMimeType", "application/json"
                )
        );

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("x-goog-api-key", properties.getGeminiApiKey());

        try {
            ResponseEntity<JsonNode> response = restTemplate.exchange(
                    uri,
                    HttpMethod.POST,
                    new HttpEntity<>(body, headers),
                    JsonNode.class
            );

            JsonNode root = response.getBody();

            JsonNode candidate = root == null
                    ? null
                    : root.path("candidates").path(0);

            JsonNode usage = root == null ? null : root.path("usageMetadata");
            String finishReason = candidate == null ? "MISSING" : candidate.path("finishReason").asText("MISSING");
            Long inputTokens = usage != null && usage.hasNonNull("promptTokenCount")
                    ? usage.get("promptTokenCount").asLong() : null;
            Long outputTokens = usage != null && usage.hasNonNull("candidatesTokenCount")
                    ? usage.get("candidatesTokenCount").asLong() : null;
            log.info("Gemini generation metadata: model={}, finishReason={}, inputTokens={}, outputTokens={}, maxOutputTokens={}",
                    properties.getGeminiModel(), finishReason, inputTokens, outputTokens, maxOutputTokens);

            if (candidate == null
                    || candidate.isMissingNode()
                    || !candidate.isObject()) {

                throw new GeminiProviderException(
                        "GEMINI_INVALID_RESPONSE", false);
            }

            if ("MAX_TOKENS".equals(finishReason)) {
                throw new GeminiProviderException(
                        "GEMINI_OUTPUT_TRUNCATED", false);
            }

            if (!"STOP".equals(finishReason)) {
                throw new GeminiProviderException(
                        "SAFETY".equals(finishReason)
                                || "RECITATION".equals(finishReason)
                                        ? "GEMINI_RESPONSE_BLOCKED"
                                        : "GEMINI_INVALID_RESPONSE",
                        false
                );
            }

            JsonNode parts = candidate.path("content").path("parts");

            if (!parts.isArray()) {
                throw new GeminiProviderException(
                        "GEMINI_INVALID_RESPONSE", false);
            }

            StringBuilder generatedText = new StringBuilder();

            for (JsonNode part : parts) {
                if (part.hasNonNull("text")
                        && part.path("text").isTextual()
                        && !part.path("thought").asBoolean(false)) {

                    generatedText.append(part.path("text").asText());
                }
            }

            if (generatedText.length() == 0
                    || generatedText.toString().isBlank()) {

                throw new GeminiProviderException(
                        "GEMINI_INVALID_RESPONSE", false);
            }

            return new GeminiGeneration(
                    generatedText.toString(),
                    inputTokens,
                    outputTokens
            );

        } catch (HttpStatusCodeException ex) {
            int status = ex.getStatusCode().value();
            ProviderFailure failure = classifyHttpFailure(status, ex.getResponseBodyAsString());
            log.warn("Gemini HTTP request failed: status={}, category={}, retryable={}",
                    status, failure.category(), failure.retryable());
            throw new GeminiProviderException(failure.code(), failure.retryable(), ex);

        } catch (ResourceAccessException ex) {

            throw new GeminiProviderException(
                    "GEMINI_TIMEOUT_OR_CONNECTION_FAILURE",
                    true,
                    ex
            );
        }
    }

    private ProviderFailure classifyHttpFailure(int status, String responseBody) {
        if (status == 503) {
            return new ProviderFailure("GEMINI_SERVICE_UNAVAILABLE", "service_unavailable", true);
        }
        if (status == 429) {
            String signals = providerErrorSignals(responseBody);
            if (signals.contains("quota") || signals.contains("billing") || signals.contains("spend cap")) {
                return new ProviderFailure("GEMINI_QUOTA_EXCEEDED", "quota_exceeded", false);
            }
            if (signals.contains("rate limit") || signals.contains("rate_limit")
                    || signals.contains("too many requests") || signals.contains("per-minute")
                    || signals.contains("per minute") || signals.contains("requests per")
                    || signals.contains("tokens per")) {
                return new ProviderFailure("GEMINI_RATE_LIMITED", "rate_limited", true);
            }
            return new ProviderFailure("GEMINI_RESOURCE_EXHAUSTED", "resource_exhausted_unspecified", false);
        }
        return new ProviderFailure("GEMINI_REQUEST_FAILED", "request_failed", false);
    }

    /** Extract only provider error classification fields; never log this value or the body. */
    private String providerErrorSignals(String responseBody) {
        try {
            JsonNode error = objectMapper.readTree(responseBody).path("error");
            List<String> signals = new ArrayList<>();
            addSignal(signals, error.path("status"));
            addSignal(signals, error.path("message"));
            JsonNode details = error.path("details");
            if (details.isArray()) {
                for (JsonNode detail : details) {
                    addSignal(signals, detail.path("reason"));
                }
            }
            return String.join(" ", signals).toLowerCase(Locale.ROOT);
        } catch (Exception ignored) {
            return "";
        }
    }

    private void addSignal(List<String> signals, JsonNode value) {
        if (value != null && value.isTextual()) {
            signals.add(value.asText());
        }
    }

    private record ProviderFailure(String code, String category, boolean retryable) {}

    public record GeminiGeneration(
            String text,
            Long inputTokens,
            Long outputTokens) {
    }

    public static class GeminiProviderException extends RuntimeException {

        private final String code;
        private final boolean retryable;

        public GeminiProviderException(
                String code,
                boolean retryable) {

            super(code);
            this.code = code;
            this.retryable = retryable;
        }

        public GeminiProviderException(
                String code,
                boolean retryable,
                Throwable cause) {

            super(code, cause);
            this.code = code;
            this.retryable = retryable;
        }

        public String getCode() {
            return code;
        }

        public boolean isRetryable() {
            return retryable;
        }
    }
}
