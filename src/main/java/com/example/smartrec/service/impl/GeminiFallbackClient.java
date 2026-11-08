
package com.example.smartrec.service.impl;

import java.net.URI;
import java.util.List;
import java.util.Map;

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

            if (candidate == null
                    || candidate.isMissingNode()
                    || !candidate.isObject()) {

                throw new GeminiProviderException(
                        "GEMINI_INVALID_RESPONSE", false);
            }

            String finishReason = candidate.path("finishReason").asText("");

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

            JsonNode usage = root.path("usageMetadata");

            return new GeminiGeneration(
                    generatedText.toString(),
                    usage.hasNonNull("promptTokenCount")
                            ? usage.get("promptTokenCount").asLong()
                            : null,
                    usage.hasNonNull("candidatesTokenCount")
                            ? usage.get("candidatesTokenCount").asLong()
                            : null
            );

        } catch (HttpStatusCodeException ex) {

            int status = ex.getStatusCode().value();

            throw new GeminiProviderException(
                    status == 429 || status == 503
                            ? "GEMINI_TEMPORARILY_UNAVAILABLE"
                            : "GEMINI_REQUEST_FAILED",
                    status == 429 || status == 503,
                    ex
            );

        } catch (ResourceAccessException ex) {

            throw new GeminiProviderException(
                    "GEMINI_TIMEOUT_OR_CONNECTION_FAILURE",
                    true,
                    ex
            );
        }
    }

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
