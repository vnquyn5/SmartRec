package com.example.smartrec.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import com.example.smartrec.config.AIModelRouterProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

class GeminiFallbackClientTest {

    @Test
    void requestsJsonAndExtractsOnlyCompletedCandidateText() {
        AIModelRouterProperties properties = properties();
        RestTemplate requestTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(requestTemplate).build();
        server.expect(requestTo("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("x-goog-api-key", "unit-test-key"))
                .andExpect(content().json("""
                        {"generationConfig":{"responseMimeType":"application/json"}}
                        """, false))
                .andRespond(withSuccess("""
                        {
                          "candidates": [{
                            "finishReason": "STOP",
                            "content": {"parts": [
                              {"text": "private reasoning", "thought": true},
                              {"text": "{\\\"schema_version\\\":\\\"smartrec.ai.meeting-summary.v1\\\"}"}
                            ]}
                          }],
                          "usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 4}
                        }
                        """, MediaType.APPLICATION_JSON));
        GeminiFallbackClient client = new GeminiFallbackClient(
                requestTemplate,
                properties,
                new ObjectMapper());

        var generated = client.generate("system", "prompt", 512);

        assertEquals("{\"schema_version\":\"smartrec.ai.meeting-summary.v1\"}", generated.text());
        assertEquals(9L, generated.inputTokens());
        assertEquals(4L, generated.outputTokens());
        server.verify();
    }

    @Test
    void rejectsCandidateTruncatedByGeminiTokenLimit() {
        AIModelRouterProperties properties = properties();
        RestTemplate requestTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(requestTemplate).build();
        server.expect(requestTo("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"))
                .andRespond(withSuccess("""
                        {"candidates":[{"finishReason":"MAX_TOKENS","content":{"parts":[{"text":"{"}]}}]}
                        """, MediaType.APPLICATION_JSON));
        GeminiFallbackClient client = new GeminiFallbackClient(
                requestTemplate,
                properties,
                new ObjectMapper());

        GeminiFallbackClient.GeminiProviderException error = assertThrows(
                GeminiFallbackClient.GeminiProviderException.class,
                () -> client.generate("system", "prompt", 512));

        assertEquals("GEMINI_OUTPUT_TRUNCATED", error.getCode());
        server.verify();
    }

    @Test
    void classifiesQuotaAndRateLimit429WithoutLoggingProviderBody() {
        assertHttpFailure(429,
                "{\"error\":{\"status\":\"RESOURCE_EXHAUSTED\",\"message\":\"Quota exceeded for private project\"}}",
                "GEMINI_QUOTA_EXCEEDED", false);
        assertHttpFailure(429,
                "{\"error\":{\"status\":\"RESOURCE_EXHAUSTED\",\"message\":\"Rate limit exceeded per minute\"}}",
                "GEMINI_RATE_LIMITED", true);
        assertHttpFailure(429,
                "{\"error\":{\"status\":\"RESOURCE_EXHAUSTED\",\"message\":\"Resource exhausted\"}}",
                "GEMINI_RESOURCE_EXHAUSTED", false);
    }

    @Test
    void classifies503AsRetryableServiceUnavailable() {
        assertHttpFailure(503,
                "{\"error\":{\"status\":\"UNAVAILABLE\",\"message\":\"Service unavailable\"}}",
                "GEMINI_SERVICE_UNAVAILABLE", true);
    }

    private static void assertHttpFailure(int status, String responseBody, String expectedCode, boolean retryable) {
        AIModelRouterProperties properties = properties();
        RestTemplate requestTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(requestTemplate).build();
        HttpStatus httpStatus = HttpStatus.valueOf(status);
        server.expect(requestTo("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"))
                .andRespond(withStatus(httpStatus).contentType(MediaType.APPLICATION_JSON).body(responseBody));
        GeminiFallbackClient client = new GeminiFallbackClient(requestTemplate, properties, new ObjectMapper());

        GeminiFallbackClient.GeminiProviderException error = assertThrows(
                GeminiFallbackClient.GeminiProviderException.class,
                () -> client.generate("system", "prompt", 512));

        assertEquals(expectedCode, error.getCode());
        assertEquals(retryable, error.isRetryable());
        assertFalse(error.getMessage().contains(responseBody));
        server.verify();
    }

    private static AIModelRouterProperties properties() {
        AIModelRouterProperties properties = new AIModelRouterProperties();
        properties.setGeminiModel("gemini-2.5-flash");
        properties.setGeminiApiKey("unit-test-key");
        properties.setGeminiTimeoutMs(1000);
        return properties;
    }
}
