package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.Transcript;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.model.dto.AiUsageRequest;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.repository.TranscriptRepository;
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
    private final SpeakerRepository speakerRepository;
    private final TranscriptRepository transcriptRepository;
    private final AIResponseValidator responseValidator;
    private final AiUsageIngestionService aiUsageIngestionService;

    @Override
    @Transactional
    public void saveAIResult(AIResponse response) {
        responseValidator.validate(response);

        Job job = jobRepository.findByIdForUpdate(response.getJobId())
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        "JOB_NOT_FOUND", "Không tìm thấy Processing Job"));
        if (!java.util.Objects.equals(job.getMeetingId(), response.getMeetingId())) {
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
        JsonNode actionItems = response.getResult().get("actionItems");
        if (actionItems == null || !actionItems.isArray()) {
            throw new BusinessException(HttpStatus.BAD_GATEWAY,
                    "AI_ACTION_ITEMS_INVALID", "AI Result yêu cầu actionItems dạng array");
        }

        List<ActionItem> existingItems = actionItemRepository.findByProcessingJobId(job.getId());
        List<ActionItem> newItems = new ArrayList<>();
        for (JsonNode item : actionItems) {
            if (item == null || !item.isObject() || !item.hasNonNull("taskName")
                    || !item.get("taskName").isTextual() || item.get("taskName").asText().isBlank()) {
                throw new BusinessException(HttpStatus.BAD_GATEWAY,
                        "AI_ACTION_ITEM_INVALID", "Mỗi action item phải có taskName dạng chuỗi");
            }

            String taskName = item.get("taskName").asText().trim();
            List<String> sourceRefs = sourceRefs(item);
            ActionItem existing = existingItems.stream()
                    .filter(candidate -> taskName.equals(candidate.getTaskName())
                            && sourceRefs.equals(candidate.getSourceRefs()))
                    .findFirst()
                    .orElse(null);
            if (existing != null) {
                // Exact duplicate/retry: retain the row, its ID and any user-managed fields.
                continue;
            }
            long existingWithSameEvidence = existingItems.stream()
                    .filter(candidate -> sourceRefs.equals(candidate.getSourceRefs()))
                    .count();
            long incomingWithSameEvidence = java.util.stream.StreamSupport
                    .stream(actionItems.spliterator(), false)
                    .filter(candidate -> candidate.isObject()
                            && taskName.equals(textValue(candidate, "taskName"))
                            && sourceRefs(candidate).equals(sourceRefs))
                    .count();
            if (!sourceRefs.isEmpty()
                    && existingWithSameEvidence == 1 && incomingWithSameEvidence == 1) {
                // A changed generated title can still be the same single task
                // supported by this evidence; avoid replacing a row users may
                // already have reviewed or edited.
                continue;
            }

            ActionItem actionItem = new ActionItem();
            actionItem.setMeetingId(job.getMeetingId());
            actionItem.setProcessingJobId(job.getId());
            actionItem.setTaskName(taskName);
            String assigneeName = textValue(item, "assigneeName");
            if ("null".equalsIgnoreCase(assigneeName)) assigneeName = null;
            actionItem.setAssigneeName(assigneeName);
            applyAssigneeIdentity(actionItem, assigneeName, sourceRefs, job);
            actionItem.setStatus(textValue(item, "status") == null ? "OPEN" : textValue(item, "status"));
            actionItem.setVerified(false);
            actionItem.setSourceRefs(sourceRefs);
            UUID sourceTranscriptId = uuidValue(item, "sourceTranscriptId");
            actionItem.setSourceTranscriptId(sourceTranscriptId != null
                    ? sourceTranscriptId : singleTranscriptId(sourceRefs));
            actionItem.setDueDate(instantValue(item, "dueDate"));
            actionItem.setDeadlineRaw(textValue(item, "deadlineRaw"));
            newItems.add(actionItem);
        }

        if (!newItems.isEmpty()) {
            actionItemRepository.saveAll(newItems);
        }
    }

    private void applyAssigneeIdentity(ActionItem actionItem, String assigneeName, List<String> sourceRefs, Job job) {
        if (assigneeName != null) {
            actionItem.setAssignmentProvenance("EXPLICIT_NAMED");
            String key = normalizeName(assigneeName);
            List<Speaker> exactMatches = speakerRepository.findByMeetingId(job.getMeetingId()).stream()
                    .filter(speaker -> speaker.getRealName() != null
                            && normalizeName(speaker.getRealName()).equals(key))
                    .toList();
            if (exactMatches.size() == 1) actionItem.setAssigneeSpeakerId(exactMatches.get(0).getId());
            return;
        }

        UUID linkedSpeakerId = firstPersonSpeaker(sourceRefs, job);
        Speaker confirmedSpeaker = linkedSpeakerId == null ? null
                : speakerRepository.findById(linkedSpeakerId)
                        .filter(speaker -> job.getMeetingId().equals(speaker.getMeetingId()))
                        .filter(speaker -> speaker.getRealName() != null && !speaker.getRealName().isBlank())
                        .orElse(null);
        if (confirmedSpeaker == null) {
            actionItem.setAssignmentProvenance("UNKNOWN");
            return;
        }
        actionItem.setAssigneeSpeakerId(confirmedSpeaker.getId());
        actionItem.setAssignmentProvenance("FIRST_PERSON_COMMITMENT");
    }

    private UUID firstPersonSpeaker(List<String> sourceRefs, Job job) {
        List<UUID> transcriptIds = new ArrayList<>();
        for (String ref : sourceRefs) {
            if (!ref.startsWith("TRANSCRIPT:")) continue;
            try {
                transcriptIds.add(UUID.fromString(ref.substring("TRANSCRIPT:".length())));
            } catch (IllegalArgumentException ignored) {
                return null;
            }
        }
        List<UUID> distinctIds = transcriptIds.stream().distinct().toList();
        if (distinctIds.isEmpty()) return null;

        List<Transcript> evidence = transcriptRepository.findAllById(distinctIds);
        if (evidence.size() != distinctIds.size()) return null;
        UUID speakerId = null;
        boolean explicitCommitment = false;
        for (Transcript transcript : evidence) {
            if (!job.getId().equals(transcript.getProcessingJobId())
                    || !job.getMeetingId().equals(transcript.getMeetingId())
                    || !"ATTRIBUTED".equals(transcript.getAttributionStatus())
                    || transcript.getSpeakerId() == null) return null;
            if (speakerId == null) speakerId = transcript.getSpeakerId();
            else if (!speakerId.equals(transcript.getSpeakerId())) return null;
            String text = transcript.getTextContent();
            if (ActionItemAssigneeResolver.hasExplicitFirstPersonCommitment(text)) explicitCommitment = true;
        }
        return explicitCommitment ? speakerId : null;
    }

    private String normalizeName(String name) {
        return java.text.Normalizer.normalize(name.trim(), java.text.Normalizer.Form.NFC)
                .toLowerCase(Locale.ROOT);
    }

    private List<String> sourceRefs(JsonNode item) {
        JsonNode refs = item.get("sourceRefs");
        if (refs == null || refs.isNull()) {
            return List.of(); // Backward-compatible with older AIResponse producers.
        }
        if (!refs.isArray()) {
            throw new BusinessException(HttpStatus.BAD_GATEWAY,
                    "AI_ACTION_ITEM_INVALID", "sourceRefs phải là một mảng chuỗi");
        }
        List<String> values = new ArrayList<>();
        for (JsonNode ref : refs) {
            if (!ref.isTextual() || ref.asText().isBlank()) {
                throw new BusinessException(HttpStatus.BAD_GATEWAY,
                        "AI_ACTION_ITEM_INVALID", "sourceRefs phải chứa chuỗi không rỗng");
            }
            values.add(ref.asText());
        }
        return List.copyOf(values);
    }

    private UUID singleTranscriptId(List<String> sourceRefs) {
        if (sourceRefs.size() != 1 || !sourceRefs.get(0).startsWith("TRANSCRIPT:")) {
            return null;
        }
        try {
            return UUID.fromString(sourceRefs.get(0).substring("TRANSCRIPT:".length()));
        } catch (IllegalArgumentException ex) {
            throw new BusinessException(HttpStatus.BAD_GATEWAY,
                    "AI_ACTION_ITEM_INVALID", "sourceRefs chứa transcript ID không hợp lệ");
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
