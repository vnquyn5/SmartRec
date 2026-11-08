package com.example.smartrec.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
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

    private static AIModelRouterProperties properties() {
        AIModelRouterProperties properties = new AIModelRouterProperties();
        properties.setGeminiModel("gemini-2.5-flash");
        properties.setGeminiApiKey("unit-test-key");
        properties.setGeminiTimeoutMs(1000);
        return properties;
    }
}
