package com.example.smartrec.service;

import java.net.URI;

import com.fasterxml.jackson.core.JsonProcessingException;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import com.example.smartrec.config.AIEngineConfig;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.InternalLLMContracts.GenerateRequest;
import com.example.smartrec.model.dto.InternalLLMContracts.GenerateResponse;
import com.example.smartrec.model.dto.InternalLLMContracts.PrepareRequest;
import com.example.smartrec.model.dto.InternalLLMContracts.PrepareResponse;
import com.example.smartrec.model.dto.InternalLLMContracts.ValidateRequest;
import com.example.smartrec.model.dto.InternalLLMContracts.ValidateResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;


@Service
public class LocalLLMAdapterClient {
    private final AIEngineConfig config;
    private final RestTemplate aiEngineRestTemplate;
    private final ObjectMapper objectMapper;

    public LocalLLMAdapterClient(
            AIEngineConfig config,
            @Qualifier("aiEngineRestTemplate") RestTemplate aiEngineRestTemplate,
            ObjectMapper objectMapper) {
        this.config = config;
        this.aiEngineRestTemplate = aiEngineRestTemplate;
        this.objectMapper = objectMapper;
    }

    public PrepareResponse prepare(PrepareRequest request) {
        return post(config.getPreparePath(), request, PrepareResponse.class, false);
    }

    public GenerateResponse generate(GenerateRequest request) {
        return post(config.getGeneratePath(), request, GenerateResponse.class, true);
    }

    public ValidateResponse validateFallback(ValidateRequest request) {
        return post(config.getValidatePath(), request, ValidateResponse.class, false);
    }

    private <T> T post(String path, Object body, Class<T> responseType, boolean inferenceRequest) {
        if (config.getBaseUrl() == null || config.getBaseUrl().isBlank()
                || config.getInternalToken() == null || config.getInternalToken().isBlank()
                || path == null || !path.startsWith("/")) {
            throw new BusinessException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "AI_ENGINE_NOT_CONFIGURED", "Internal AI Engine configuration is incomplete");
        }

        URI baseUri;
        try {
            baseUri = URI.create(config.getBaseUrl().replaceAll("/+$", ""));
        } catch (IllegalArgumentException ex) {
            throw new BusinessException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "AI_ENGINE_CONFIGURATION_INVALID", "Internal AI Engine URL is invalid");
        }
        if (!("http".equalsIgnoreCase(baseUri.getScheme()) || "https".equalsIgnoreCase(baseUri.getScheme()))
                || baseUri.getHost() == null || baseUri.getUserInfo() != null || baseUri.getQuery() != null
                || baseUri.getFragment() != null
                || (baseUri.getPath() != null && !baseUri.getPath().isEmpty() && !"/".equals(baseUri.getPath()))) {
            throw new BusinessException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "AI_ENGINE_CONFIGURATION_INVALID", "Internal AI Engine URL is invalid");
        }

        URI uri;
        try {
            uri = URI.create(baseUri.toString() + path);
        } catch (IllegalArgumentException ex) {
            throw new BusinessException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "AI_ENGINE_CONFIGURATION_INVALID", "Internal AI Engine URL is invalid");
        }
        if (uri.getQuery() != null || uri.getFragment() != null) {
            throw new BusinessException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "AI_ENGINE_CONFIGURATION_INVALID", "Internal AI Engine URL is invalid");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Internal-Token", config.getInternalToken());
        try {
            ResponseEntity<T> response = aiEngineRestTemplate.exchange(
                    uri, HttpMethod.POST, new HttpEntity<>(body, headers), responseType);
            if (response.getBody() == null) {
                throw new AdapterException("LOCAL_ADAPTER_INVALID_RESPONSE", false);
            }
            return response.getBody();
        } catch (HttpStatusCodeException ex) {
            String code = responseCode(ex);
            throw new AdapterException(code, inferenceRequest && isFallbackEligible(code), ex);
        } catch (ResourceAccessException ex) {
            throw new AdapterException(
                    inferenceRequest ? "LOCAL_ADAPTER_UNAVAILABLE" : "AI_ENGINE_UNAVAILABLE",
                    inferenceRequest,
                    ex);
        } catch (RestClientException ex) {
            throw new AdapterException("LOCAL_ADAPTER_INVALID_RESPONSE", inferenceRequest, ex);
        }
    }

    private String responseCode(HttpStatusCodeException exception) {
        try {
            JsonNode body = objectMapper.readTree(exception.getResponseBodyAsString());
            JsonNode detail = body.path("detail");
            JsonNode code = detail.isObject() ? detail.path("code") : body.path("code");
            if (code.isTextual() && !code.asText().isBlank()) {
                return code.asText();
            }
        } catch (JsonProcessingException ignored) {
            // Response bodies are untrusted; HTTP status remains the safe fallback signal.
        }
        int status = exception.getStatusCode().value();
        return status == 502 || status == 503 || status == 504
                ? "LOCAL_ADAPTER_UNAVAILABLE"
                : "LOCAL_ADAPTER_REJECTED";
    }

    private boolean isFallbackEligible(String code) {
        return switch (code) {
            case "LOCAL_MODEL_TIMEOUT", "LOCAL_MODEL_UNAVAILABLE", "LOCAL_MODEL_INVALID_RESPONSE",
                    "LOCAL_MODEL_TRUNCATED", "LOCAL_ADAPTER_UNAVAILABLE", "JSON_PARSE_ERROR", "SCHEMA_VALIDATION_ERROR",
                    "SOURCE_REFERENCE_ERROR" -> true;
            default -> false;
        };
    }

    public static class AdapterException extends RuntimeException {
        private final String code;
        private final boolean fallbackEligible;

        public AdapterException(String code, boolean fallbackEligible) {
            super(code);
            this.code = code;
            this.fallbackEligible = fallbackEligible;
        }

        public AdapterException(String code, boolean fallbackEligible, Throwable cause) {
            super(code, cause);
            this.code = code;
            this.fallbackEligible = fallbackEligible;
        }

        public String getCode() {
            return code;
        }

        public boolean isFallbackEligible() {
            return fallbackEligible;
        }
    }
}
