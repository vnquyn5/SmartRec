package com.example.smartrec.controller;

import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.service.impl.AIModelRouter;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/internal/jobs")
@RequiredArgsConstructor
public class AIInferenceController {
    private final AIModelRouter modelRouter;

    @Value("${smartrec.internal-token:}")
    private String configuredInternalToken;

    @Value("${smartrec.llm.enabled:true}")
    private boolean llmEnabled;

    @PostMapping("/{jobId}/ai-result")
    public ResponseEntity<AIResponse> generateAIResult(
            @PathVariable UUID jobId,
            @RequestHeader("X-Execution-Id") UUID executionId,
            @RequestHeader(value = "X-Internal-Token", required = false) String internalToken) {
        if (internalToken == null || configuredInternalToken == null || configuredInternalToken.isBlank()
                || !configuredInternalToken.equals(internalToken.trim())) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED,
                    "INVALID_INTERNAL_TOKEN", "Internal authentication failed");
        }
        if (!llmEnabled) {
            throw new BusinessException(HttpStatus.CONFLICT,
                    "LLM_DISABLED", "LLM enrichment is disabled for this deployment");
        }
        return ResponseEntity.ok(modelRouter.generate(jobId, executionId));
    }
}
