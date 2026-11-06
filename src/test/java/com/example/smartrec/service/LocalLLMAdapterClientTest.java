package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.response.MockRestResponseCreators;
import org.springframework.web.client.RestTemplate;

import com.example.smartrec.config.AIEngineConfig;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.InternalLLMContracts;
import com.fasterxml.jackson.databind.ObjectMapper;

class LocalLLMAdapterClientTest {
    private static final UUID REQUEST_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID JOB_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID MEETING_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID TRANSCRIPT_ID = UUID.fromString("44444444-4444-4444-8444-444444444444");

    @Test
    void acceptsApiPathAndSendsInternalAuthenticationHeader() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        server.expect(requestTo("http://127.0.0.1:8000/api/v1/internal/llm/prepare"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Token", "local-test-token"))
                .andRespond(withSuccess("""
                        {
                          "contractVersion": "smartrec.local-llm.v1",
                          "requestId": "11111111-1111-4111-8111-111111111111",
                          "jobId": "22222222-2222-4222-8222-222222222222",
                          "meetingId": "33333333-3333-4333-8333-333333333333",
                          "taskType": "MEETING_ANALYSIS",
                          "systemPrompt": "system",
                          "prompt": "prompt",
                          "allowedSourceRefs": ["TRANSCRIPT:44444444-4444-4444-8444-444444444444"],
                          "schemaVersion": "smartrec.ai.meeting-summary.v1"
                        }
                        """, MediaType.APPLICATION_JSON));

        InternalLLMContracts.PrepareResponse response = client(restTemplate).prepare(request());

        assertEquals(InternalLLMContracts.VERSION, response.contractVersion());
        assertEquals(REQUEST_ID, response.requestId());
        server.verify();
    }

    @Test
    void rejectsBaseUrlThatContainsAnApiPath() {
        AIEngineConfig config = new AIEngineConfig();
        config.setBaseUrl("http://127.0.0.1:8000/api/v1");
        config.setPreparePath("/api/v1/internal/llm/prepare");
        config.setInternalToken("local-test-token");
        LocalLLMAdapterClient client = new LocalLLMAdapterClient(
                config, new RestTemplate(), new ObjectMapper());

        BusinessException error = assertThrows(BusinessException.class, () -> client.prepare(request()));

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, error.getStatus());
        assertEquals("AI_ENGINE_CONFIGURATION_INVALID", error.getCode());
    }

    @ParameterizedTest
    @CsvSource({
            "400,AI_ENGINE_BAD_REQUEST",
            "401,AI_ENGINE_UNAUTHORIZED",
            "409,AI_ENGINE_CONFLICT",
            "422,AI_ENGINE_VALIDATION_FAILED",
            "502,AI_ENGINE_BAD_GATEWAY",
            "503,LOCAL_ADAPTER_UNAVAILABLE",
            "504,LOCAL_ADAPTER_UNAVAILABLE"
    })
    void retainsAiEngineHttpFailureCategory(int statusCode, String expectedCode) {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        server.expect(requestTo("http://127.0.0.1:8000/api/v1/internal/llm/prepare"))
                .andRespond(MockRestResponseCreators.withStatus(HttpStatus.valueOf(statusCode)));

        LocalLLMAdapterClient.AdapterException error = assertThrows(
                LocalLLMAdapterClient.AdapterException.class,
                () -> client(restTemplate).prepare(request()));

        assertTrue(error.getMessage().contains(expectedCode));
        server.verify();
    }

    @Test
    void onlyMarkedGenerationEvidenceFailureIsFallbackEligible() {
        for (String body : List.of(
                "{\"detail\":{\"code\":\"EVIDENCE_CONSISTENCY_ERROR\",\"origin\":\"MODEL_OUTPUT\"}}",
                "{\"detail\":{\"code\":\"EVIDENCE_CONSISTENCY_ERROR\"}}",
                "{}")) {
            RestTemplate restTemplate = new RestTemplate();
            MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
            server.expect(requestTo("http://127.0.0.1:8000/api/v1/internal/llm/generate"))
                    .andRespond(MockRestResponseCreators.withStatus(HttpStatus.BAD_GATEWAY)
                            .contentType(MediaType.APPLICATION_JSON).body(body));

            var error = assertThrows(LocalLLMAdapterClient.AdapterException.class,
                    () -> client(restTemplate).generate(generateRequest()));
            assertEquals(body.contains("MODEL_OUTPUT"), error.isFallbackEligible());
            server.verify();
        }
    }

    @Test
    void markedEvidenceFailureOutsideGenerationIsNotEligible() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        server.expect(requestTo("http://127.0.0.1:8000/api/v1/internal/llm/prepare"))
                .andRespond(MockRestResponseCreators.withStatus(HttpStatus.BAD_GATEWAY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("{\"detail\":{\"code\":\"EVIDENCE_CONSISTENCY_ERROR\",\"origin\":\"MODEL_OUTPUT\"}}"));

        var error = assertThrows(LocalLLMAdapterClient.AdapterException.class,
                () -> client(restTemplate).prepare(request()));
        assertEquals(false, error.isFallbackEligible());
    }

    @Test
    void sourceReferenceFailureRequiresGeneratedOutputMarker() {
        for (boolean marked : List.of(true, false)) {
            RestTemplate restTemplate = new RestTemplate();
            MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
            String detail = marked
                    ? "{\"detail\":{\"code\":\"SOURCE_REFERENCE_ERROR\",\"origin\":\"MODEL_OUTPUT\"}}"
                    : "{\"detail\":{\"code\":\"SOURCE_REFERENCE_ERROR\"}}";
            server.expect(requestTo("http://127.0.0.1:8000/api/v1/internal/llm/generate"))
                    .andRespond(MockRestResponseCreators.withStatus(HttpStatus.BAD_GATEWAY)
                            .contentType(MediaType.APPLICATION_JSON).body(detail));

            var error = assertThrows(LocalLLMAdapterClient.AdapterException.class,
                    () -> client(restTemplate).generate(generateRequest()));
            assertEquals(marked, error.isFallbackEligible());
            server.verify();
        }
    }

    private static LocalLLMAdapterClient client(RestTemplate restTemplate) {
        AIEngineConfig config = new AIEngineConfig();
        config.setBaseUrl("http://127.0.0.1:8000");
        config.setPreparePath("/api/v1/internal/llm/prepare");
        config.setGeneratePath("/api/v1/internal/llm/generate");
        config.setInternalToken("local-test-token");
        return new LocalLLMAdapterClient(config, restTemplate, new ObjectMapper());
    }

    private static InternalLLMContracts.PrepareRequest request() {
        return new InternalLLMContracts.PrepareRequest(
                InternalLLMContracts.VERSION,
                REQUEST_ID,
                JOB_ID,
                MEETING_ID,
                "MEETING_ANALYSIS",
                List.of(new InternalLLMContracts.ContextEvidence(
                        "TRANSCRIPT", TRANSCRIPT_ID, null, 0L, 1000L, "Synthetic connectivity test.")));
    }

    private static InternalLLMContracts.GenerateRequest generateRequest() {
        return new InternalLLMContracts.GenerateRequest(
                InternalLLMContracts.VERSION, REQUEST_ID, JOB_ID, MEETING_ID,
                "MEETING_ANALYSIS", "system", "prompt", List.of("S1"),
                request().evidence(), 0.1, 2048);
    }
}
