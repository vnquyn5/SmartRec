package com.example.smartrec.service.impl;

import java.net.URI;
import java.util.List;
import java.util.Map;

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

    public GeminiFallbackClient(
            RestTemplateBuilder builder,
            AIModelRouterProperties properties,
            ObjectMapper objectMapper) {
        this.restTemplate = builder
                .setConnectTimeout(java.time.Duration.ofMillis(properties.getGeminiTimeoutMs()))
                .setReadTimeout(java.time.Duration.ofMillis(properties.getGeminiTimeoutMs()))
                .build();
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    public GeminiGeneration generate(String systemPrompt, String prompt, int maxOutputTokens) {
        String base = "https://generativelanguage.googleapis.com/v1beta/models/";
        URI uri = URI.create(base + properties.getGeminiModel() + ":generateContent");
        Map<String, Object> body = Map.of(
                "systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))),
                "contents", List.of(Map.of("role", "user", "parts", List.of(Map.of("text", prompt)))),
                "generationConfig", Map.of("maxOutputTokens", maxOutputTokens, "temperature", 0.1));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("x-goog-api-key", properties.getGeminiApiKey());
        try {
            ResponseEntity<JsonNode> response = restTemplate.exchange(
                    uri, HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
            JsonNode root = response.getBody();
            JsonNode text = root == null ? null : root.path("candidates").path(0).path("content").path("parts").path(0).path("text");
            if (text == null || !text.isTextual() || text.asText().isBlank()) {
                throw new GeminiProviderException("GEMINI_INVALID_RESPONSE", false);
            }
            JsonNode usage = root.path("usageMetadata");
            return new GeminiGeneration(
                    text.asText(),
                    usage.hasNonNull("promptTokenCount") ? usage.get("promptTokenCount").asLong() : null,
                    usage.hasNonNull("candidatesTokenCount") ? usage.get("candidatesTokenCount").asLong() : null);
        } catch (HttpStatusCodeException ex) {
            int status = ex.getStatusCode().value();
            throw new GeminiProviderException(
                    status == 429 || status == 503 ? "GEMINI_TEMPORARILY_UNAVAILABLE" : "GEMINI_REQUEST_FAILED",
                    status == 429 || status == 503,
                    ex);
        } catch (ResourceAccessException ex) {
            throw new GeminiProviderException("GEMINI_TIMEOUT_OR_CONNECTION_FAILURE", true, ex);
        }
    }

    public record GeminiGeneration(String text, Long inputTokens, Long outputTokens) {}

    public static class GeminiProviderException extends RuntimeException {
        private final String code;
        private final boolean retryable;

        public GeminiProviderException(String code, boolean retryable) {
            super(code);
            this.code = code;
            this.retryable = retryable;
        }

        public GeminiProviderException(String code, boolean retryable, Throwable cause) {
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
