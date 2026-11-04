package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.model.dto.AiUsageRequest;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.service.AIResponseValidator;
import com.example.smartrec.service.AIResultService;
import com.example.smartrec.service.AiUsageIngestionService;

import com.fasterxml.jackson.databind.JsonNode;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class AIResultServiceImpl implements AIResultService {

    private final JobRepository jobRepository;
    private final SummaryRepository summaryRepository;
    private final ActionItemRepository actionItemRepository;
    private final AIResponseValidator responseValidator;
    private final AiUsageIngestionService aiUsageIngestionService;

    @Override
    @Transactional
    public void saveAIResult(AIResponse response) {
        responseValidator.validate(response);

        Job job = jobRepository.findByIdForUpdate(response.getJobId())
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        "JOB_NOT_FOUND", "Không tìm thấy Processing Job"));
        if (!job.getMeetingId().equals(response.getMeetingId())) {
            throw new BusinessException(HttpStatus.CONFLICT,
                    "AI_MEETING_ID_MISMATCH", "meetingId trong response không khớp với Job");
        }

        if (job.getStatus() == com.example.smartrec.enums.JobStatus.COMPLETED) {
            log.info("AI result already processed: jobId={}", response.getJobId());
            return;
        }
        if (job.getStatus() == com.example.smartrec.enums.JobStatus.FAILED
                || job.getStatus() == com.example.smartrec.enums.JobStatus.DLQ
                || job.getStatus() == com.example.smartrec.enums.JobStatus.CANCELLED) {
            throw new BusinessException(HttpStatus.CONFLICT,
                    "AI_RESULT_FOR_TERMINAL_JOB", "Không nhận kết quả cho Job đã kết thúc");
        }

        if ("SUMMARY".equalsIgnoreCase(response.getTaskType())) {
            saveSummary(job, response);
        } else if ("TASK_MATRIX".equalsIgnoreCase(response.getTaskType())) {
            saveActionItems(job, response);
        } else if ("MEETING_ANALYSIS".equalsIgnoreCase(response.getTaskType())) {
            saveSummary(job, response);
            saveActionItems(job, response);
            saveUsage(response);
        }

        log.info("AI result saved: jobId={}, taskType={}, provider={}, model={}, fallbackUsed={}, "
                        + "fallbackReason={}, retryCount={}, latencyMs={}, inputTokens={}, outputTokens={}, "
                        + "estimatedCost={}",
                response.getJobId(), response.getTaskType(), response.getProvider(), response.getModel(),
                response.isFallbackUsed(), response.getFallbackReason(), response.getRetryCount(),
                response.getLatencyMs(), response.getInputTokens(), response.getOutputTokens(),
                response.getEstimatedCost());
    }

    private void saveUsage(AIResponse response) {
        AiUsageRequest usage = new AiUsageRequest();
        usage.setRequestId(response.getRequestId());
        usage.setJobId(response.getJobId());
        usage.setMeetingId(response.getMeetingId());
        usage.setModelName(response.getModel());
        usage.setProvider(response.getProvider());
        usage.setTaskType(response.getTaskType());
        usage.setInputTokens(response.getInputTokens());
        usage.setOutputTokens(response.getOutputTokens());
        usage.setTotalTokens(response.getInputTokens() != null && response.getOutputTokens() != null
                ? response.getInputTokens() + response.getOutputTokens()
                : null);
        usage.setTokenSource(response.getTokenSource());
        usage.setProcessingTimeMs(response.getLatencyMs());
        usage.setStatus("success");
        usage.setFallbackUsed(response.isFallbackUsed());
        usage.setEstimatedCost(response.getEstimatedCost());
        aiUsageIngestionService.record(usage);
    }

    private void saveSummary(Job job, AIResponse response) {
        Summary summary = summaryRepository.findByProcessingJobId(job.getId()).orElseGet(Summary::new);
        summary.setMeetingId(job.getMeetingId());
        summary.setProcessingJobId(job.getId());
        summary.setRawLlmResponse(response.getResult());

        JsonNode text = response.getResult().hasNonNull("executiveSummary")
                ? response.getResult().get("executiveSummary")
                : response.getResult().get("summary");
        if (text != null && text.isTextual()) {
            summary.setExecutiveSummary(text.asText());
        }
        summaryRepository.save(summary);
    }

    private void saveActionItems(Job job, AIResponse response) {
        List<ActionItem> items = new ArrayList<>();
        JsonNode actionItems = response.getResult().get("actionItems");
        for (JsonNode item : actionItems) {
            if (item == null || !item.isObject() || !item.hasNonNull("taskName")
                    || !item.get("taskName").isTextual() || item.get("taskName").asText().isBlank()) {
                throw new BusinessException(HttpStatus.BAD_GATEWAY,
                        "AI_ACTION_ITEM_INVALID", "Mỗi action item phải có taskName dạng chuỗi");
            }

            ActionItem actionItem = new ActionItem();
            actionItem.setMeetingId(job.getMeetingId());
            actionItem.setProcessingJobId(job.getId());
            actionItem.setTaskName(item.get("taskName").asText().trim());
            actionItem.setAssigneeName(textValue(item, "assigneeName"));
            actionItem.setStatus(textValue(item, "status") == null ? "OPEN" : textValue(item, "status"));
            actionItem.setVerified(false);
            actionItem.setSourceTranscriptId(uuidValue(item, "sourceTranscriptId"));
            actionItem.setDueDate(instantValue(item, "dueDate"));
            items.add(actionItem);
        }

        actionItemRepository.deleteByProcessingJobId(job.getId());
        if (!items.isEmpty()) {
            actionItemRepository.saveAll(items);
        }
    }

    private String textValue(JsonNode object, String field) {
        JsonNode value = object.get(field);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText().trim() : null;
    }

    private UUID uuidValue(JsonNode object, String field) {
        String value = textValue(object, field);
        if (value == null) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException ex) {
            throw new BusinessException(HttpStatus.BAD_GATEWAY,
                    "AI_ACTION_ITEM_INVALID", field + " phải là UUID hợp lệ");
        }
    }

    private Instant instantValue(JsonNode object, String field) {
        String value = textValue(object, field);
        if (value == null) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (java.time.format.DateTimeParseException ex) {
            throw new BusinessException(HttpStatus.BAD_GATEWAY,
                    "AI_ACTION_ITEM_INVALID", field + " phải là timestamp ISO-8601 UTC");
        }
    }
}
