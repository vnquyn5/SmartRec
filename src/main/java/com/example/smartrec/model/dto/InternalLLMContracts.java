package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

public final class InternalLLMContracts {
    public static final String VERSION = "smartrec.local-llm.v1";
    public static final String SUMMARY_SCHEMA_VERSION = "smartrec.ai.meeting-summary.v1";

    private InternalLLMContracts() {}

    public record ContextEvidence(
            String sourceType,
            UUID sourceId,
            UUID speakerId,
            Long startTimeMs,
            Long endTimeMs,
            String text) {}

    public record PrepareRequest(
            String contractVersion,
            UUID requestId,
            UUID jobId,
            UUID meetingId,
            String taskType,
            List<ContextEvidence> evidence) {}

    public record PrepareResponse(
            String contractVersion,
            UUID requestId,
            UUID jobId,
            UUID meetingId,
            String taskType,
            String systemPrompt,
            String prompt,
            List<String> allowedSourceRefs,
            String schemaVersion) {}

    public record GenerateRequest(
            String contractVersion,
            UUID requestId,
            UUID jobId,
            UUID meetingId,
            String taskType,
            String systemPrompt,
            String prompt,
            List<String> allowedSourceRefs,
            double temperature,
            int maxTokens) {}

    public record TokenMetadata(
            Long inputTokens,
            Long outputTokens,
            Long totalTokens,
            String source) {}

    public record GenerateResponse(
            String contractVersion,
            UUID requestId,
            UUID jobId,
            UUID meetingId,
            String taskType,
            String provider,
            String modelIdentifier,
            String status,
            JsonNode result,
            TokenMetadata tokenMetadata,
            Long processingTimeMs) {}

    public record ValidateRequest(
            String contractVersion,
            UUID requestId,
            UUID jobId,
            UUID meetingId,
            String taskType,
            String rawOutput,
            List<String> allowedSourceRefs) {}

    public record ValidateResponse(
            String contractVersion,
            UUID requestId,
            UUID jobId,
            UUID meetingId,
            String taskType,
            JsonNode result) {}
}
