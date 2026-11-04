package com.example.smartrec.service.impl;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.service.AIResponseValidator;

@Component
public class AIResponseValidatorImpl implements AIResponseValidator {

    @Override
    public void validate(AIResponse response) {
        if (response == null) {
            throw invalidResponse("AI_RESPONSE_NULL", "AI Engine không trả về dữ liệu");
        }
        if (response.getJobId() == null || response.getMeetingId() == null) {
            throw invalidResponse("AI_RESPONSE_ID_INVALID", "Job ID hoặc Meeting ID không hợp lệ");
        }
        if (response.getTaskType() == null || response.getTaskType().isBlank()) {
            throw invalidResponse("AI_TASK_TYPE_MISSING", "taskType không được để trống");
        }
        if (!"SUMMARY".equalsIgnoreCase(response.getTaskType())
                && !"TASK_MATRIX".equalsIgnoreCase(response.getTaskType())
                && !"MEETING_ANALYSIS".equalsIgnoreCase(response.getTaskType())) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_AI_TASK_TYPE",
                    "Loại tác vụ AI không được hỗ trợ");
        }
        if (!"SUCCESS".equalsIgnoreCase(response.getStatus())) {
            throw new BusinessException(HttpStatus.BAD_GATEWAY, "AI_PROCESSING_FAILED",
                    "AI Engine xử lý thất bại");
        }
        if (response.getResult() == null || !response.getResult().isObject()) {
            throw invalidResponse("AI_RESPONSE_INVALID", "result phải là một JSON object");
        }
        if (response.getRetryCount() != null && response.getRetryCount() < 0
                || response.getLatencyMs() != null && response.getLatencyMs() < 0
                || response.getInputTokens() != null && response.getInputTokens() < 0
                || response.getOutputTokens() != null && response.getOutputTokens() < 0
                || response.getEstimatedCost() != null && response.getEstimatedCost() < 0) {
            throw invalidResponse("AI_METADATA_INVALID", "Metadata số không được nhỏ hơn 0");
        }
        if ("TASK_MATRIX".equalsIgnoreCase(response.getTaskType())
                && (!response.getResult().has("actionItems")
                        || !response.getResult().get("actionItems").isArray())) {
            throw invalidResponse("AI_TASK_MATRIX_INVALID", "result.actionItems phải là một JSON array");
        }
        if ("MEETING_ANALYSIS".equalsIgnoreCase(response.getTaskType())) {
            if (response.getRequestId() == null
                    || response.getProvider() == null
                    || (!"LOCAL".equals(response.getProvider()) && !"GEMINI".equals(response.getProvider()))
                    || response.getModel() == null || response.getModel().isBlank()
                    || response.getLatencyMs() == null
                    || response.getTokenSource() == null
                    || !java.util.Set.of(
                            "provider_metadata", "gemini_metadata", "ollama_metadata", "unavailable")
                            .contains(response.getTokenSource())) {
                throw invalidResponse(
                        "AI_USAGE_METADATA_INVALID",
                        "MEETING_ANALYSIS yêu cầu metadata inference hợp lệ");
            }

            var result = response.getResult();

            var summary = result.hasNonNull("executiveSummary")
                    ? result.get("executiveSummary")
                    : result.get("summary");

            if (summary == null || !summary.isTextual()
                    || summary.asText().isBlank()) {
                throw invalidResponse(
                        "AI_SUMMARY_INVALID",
                        "MEETING_ANALYSIS yêu cầu nội dung tóm tắt hợp lệ");
            }

            if (!result.has("actionItems")
                    || !result.get("actionItems").isArray()) {
                throw invalidResponse(
                        "AI_ACTION_ITEMS_INVALID",
                        "MEETING_ANALYSIS yêu cầu actionItems dạng array");
            }
        }
    }

    private BusinessException invalidResponse(String code, String message) {
        return new BusinessException(HttpStatus.BAD_GATEWAY, code, message);
    }
}
