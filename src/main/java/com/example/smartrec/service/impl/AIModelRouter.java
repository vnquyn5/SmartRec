package com.example.smartrec.service.impl;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.example.smartrec.config.AIModelRouterProperties;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.model.dto.InternalLLMContracts;
import com.example.smartrec.model.dto.InternalLLMContracts.ContextEvidence;
import com.example.smartrec.model.dto.InternalLLMContracts.GenerateRequest;
import com.example.smartrec.model.dto.InternalLLMContracts.GenerateResponse;
import com.example.smartrec.model.dto.InternalLLMContracts.PrepareRequest;
import com.example.smartrec.model.dto.InternalLLMContracts.PrepareResponse;
import com.example.smartrec.model.dto.InternalLLMContracts.TokenMetadata;
import com.example.smartrec.model.dto.InternalLLMContracts.ValidateRequest;
import com.example.smartrec.model.dto.InternalLLMContracts.ValidateResponse;
import com.example.smartrec.model.dto.JobContext;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.service.AIResponseValidator;
import com.example.smartrec.service.ContextPayloadService;
import com.example.smartrec.service.LocalLLMAdapterClient;
import com.example.smartrec.service.LocalLLMAdapterClient.AdapterException;
import com.example.smartrec.service.impl.GeminiFallbackClient.GeminiGeneration;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class AIModelRouter {
    private static final Logger log = LoggerFactory.getLogger(AIModelRouter.class);
    private static final String TASK_TYPE = "MEETING_ANALYSIS";
    private static final String TASK_NAMESPACE = "smartrec-ai-inference-v1:";

    private final AIModelRouterProperties properties;
    private final JobRepository jobRepository;
    private final ContextPayloadService contextPayloadService;
    private final LocalLLMAdapterClient localClient;
    private final GeminiFallbackService geminiFallbackService;
    private final AIResponseValidator responseValidator;
    private final ObjectMapper objectMapper;

    private int localFailures;
    private long localCircuitOpenUntilNanos;
    private Clock clock = Clock.systemUTC();

    public AIResponse generate(UUID jobId, UUID executionId) {
        JobRepository.ExecutionLeaseView job = requireLiveExecution(jobId, null, executionId);
        return generate(jobId, job.getMeetingId(), executionId);
    }

    public AIResponse generate(UUID jobId, UUID meetingId, UUID executionId) {
        requireLiveExecution(jobId, meetingId, executionId);
        JobContext context = contextPayloadService.createJobContext(meetingId, jobId, true);
        verifyContext(context, meetingId, jobId);

        UUID requestId = stableRequestId(jobId);
        List<ContextEvidence> evidence = context.evidence().stream()
                .map(item -> new ContextEvidence(item.sourceType(), item.sourceId(), item.speakerId(),
                        item.startTimeMs(), item.endTimeMs(), item.text()))
                .toList();
        PrepareResponse prepared;
        try {
            prepared = localClient.prepare(new PrepareRequest(
                    InternalLLMContracts.VERSION, requestId, jobId, meetingId, TASK_TYPE, evidence));
        } catch (AdapterException ex) {
            throw inferenceFailure("AI_PROMPT_PREPARATION_FAILED", ex);
        }
        verifyPreparation(prepared, requestId, jobId, meetingId, evidence);
        requireLiveExecution(jobId, meetingId, executionId);

        AdapterException localFailure = null;
        int localAttemptsExecuted = 0;
        long inferenceStartedNanos = System.nanoTime();
        // Respect the configured finite attempt count. Keep the same verified
        // prompt and never feed a failed/raw model response into a later attempt.
        int attempts = Math.max(1, properties.getLocalMaxAttempts());
        for (int attempt = 1; attempt <= attempts; attempt++) {
            if (isLocalCircuitOpen()) {
                localFailure = new AdapterException("LOCAL_CIRCUIT_OPEN", true);
                break;
            }
            try {
                localAttemptsExecuted++;
                GenerateResponse generated = localClient.generate(new GenerateRequest(
                        InternalLLMContracts.VERSION,
                        requestId,
                        jobId,
                        meetingId,
                        TASK_TYPE,
                        prepared.systemPrompt(),
                        prepared.prompt(),
                        prepared.allowedSourceRefs(),
                        evidence,
                        0.1,
                        2048));
                requireLiveExecution(jobId, meetingId, executionId);
                verifyGeneration(generated, requestId, jobId, meetingId);
                validateSourceReferences(generated.result(), originalSourceRefs(evidence));
                AIResponse response = toBackendResponse(
                        jobId, meetingId, requestId, generated.provider(), generated.modelIdentifier(),
                        false, null, attempt - 1, generated.processingTimeMs(),
                        generated.tokenMetadata(), generated.result());
                responseValidator.validate(response);
                recordLocalSuccess();
                log.info("Local meeting summary succeeded: attempts={}, processingMs={}, inputTokens={}, outputTokens={}",
                        localAttemptsExecuted, generated.processingTimeMs(),
                        generated.tokenMetadata() == null ? null : generated.tokenMetadata().inputTokens(),
                        generated.tokenMetadata() == null ? null : generated.tokenMetadata().outputTokens());
                return response;
            } catch (AdapterException ex) {
                if (!ex.isFallbackEligible()) {
                    throw inferenceFailure("AI_LOCAL_INFERENCE_FAILED", ex);
                }
                localFailure = ex;
                recordLocalFailure();
                log.warn("Local meeting summary attempt {} failed: code={}, elapsedMs={}",
                        localAttemptsExecuted, ex.getCode(),
                        Math.max(0, (System.nanoTime() - inferenceStartedNanos) / 1_000_000L));
                // Retrying an identical prompt after a hard generation timeout
                // or token-limit truncation repeats the same expensive failure.
                if ("LOCAL_MODEL_TIMEOUT".equals(ex.getCode())
                        || "LOCAL_MODEL_TRUNCATED".equals(ex.getCode())) {
                    break;
                }
                if (ex.isModelOutputValidationFailure()) {
                    // FastAPI already normalized, validated, and performed its
                    // single local repair call before returning MODEL_OUTPUT.
                    break;
                }
                if (attempt < attempts) {
                    sleepBeforeRetry(attempt);
                }
            } catch (RestClientException ex) {
                localFailure = new AdapterException("LOCAL_ADAPTER_INVALID_RESPONSE", true, ex);
                recordLocalFailure();
                if (attempt < attempts) {
                    sleepBeforeRetry(attempt);
                }
            }
        }

        requireLiveExecution(jobId, meetingId, executionId);
        return routeToGemini(
                jobId, meetingId, executionId, requestId, prepared, evidence,
                Math.max(0, localAttemptsExecuted - 1), localFailure);
    }

    private AIResponse routeToGemini(
            UUID jobId,
            UUID meetingId,
            UUID executionId,
            UUID requestId,
            PrepareResponse prepared,
            List<ContextEvidence> evidence,
            int localRetryCount,
            AdapterException localFailure) {
        try {
            long fallbackStartedNanos = System.nanoTime();
            GeminiGeneration generated = geminiFallbackService.generate(
                jobId, meetingId, requestId, prepared.fallbackSystemPrompt(), prepared.prompt());
            requireLiveExecution(jobId, meetingId, executionId);
            ValidateResponse validated = localClient.validateFallback(new ValidateRequest(
                    InternalLLMContracts.VERSION,
                    requestId,
                    jobId,
                    meetingId,
                    TASK_TYPE,
                    generated.text(),
                    prepared.allowedSourceRefs(),
                    evidence));
            verifyValidation(validated, requestId, jobId, meetingId);
            validateSourceReferences(validated.result(), originalSourceRefs(evidence));
            TokenMetadata metadata = new TokenMetadata(
                    generated.inputTokens(),
                    generated.outputTokens(),
                    generated.inputTokens() != null && generated.outputTokens() != null
                            ? generated.inputTokens() + generated.outputTokens()
                            : null,
                    generated.inputTokens() != null || generated.outputTokens() != null
                            ? "gemini_metadata" : "unavailable");
            AIResponse response = toBackendResponse(
                    jobId, meetingId, requestId, "GEMINI", properties.getGeminiModel(), true,
                    localFailure == null ? "LOCAL_CIRCUIT_OPEN" : localFailure.getCode(),
                    localRetryCount,
                    Math.max(0, (System.nanoTime() - fallbackStartedNanos) / 1_000_000L),
                    metadata,
                    validated.result());
            responseValidator.validate(response);
            return response;
        } catch (GeminiFallbackService.GeminiFallbackDeniedException ex) {
            throw inferenceFailure("GEMINI_FALLBACK_DENIED", ex);
        } catch (GeminiFallbackClient.GeminiProviderException ex) {
            throw inferenceFailure(ex.getCode(), ex);
        } catch (AdapterException ex) {
            throw inferenceFailure(geminiValidationFailureCode(ex.getCode()), ex);
        }
    }

    private String geminiValidationFailureCode(String validationCode) {
        return switch (validationCode) {
            case "JSON_PARSE_ERROR" -> "GEMINI_JSON_INVALID";
            case "SCHEMA_VALIDATION_ERROR" -> "GEMINI_SCHEMA_MISMATCH";
            case "SOURCE_REFERENCE_ERROR" -> "GEMINI_SOURCE_REFERENCE_INVALID";
            case "EVIDENCE_CONSISTENCY_ERROR" -> "GEMINI_EVIDENCE_CONSISTENCY_FAILED";
            default -> "GEMINI_OUTPUT_VALIDATION_FAILED";
        };
    }

    private JobRepository.ExecutionLeaseView requireLiveExecution(UUID jobId, UUID meetingId, UUID executionId) {
        JobRepository.ExecutionLeaseView job = jobRepository.findExecutionLeaseById(jobId)
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND, "AI_JOB_NOT_FOUND", "Không tìm thấy Job cần inference"));
        if (job.getMeetingId() == null || (meetingId != null && !job.getMeetingId().equals(meetingId))) {
            throw new BusinessException(
                    HttpStatus.CONFLICT, "AI_MEETING_ID_MISMATCH", "Meeting không thuộc Job yêu cầu");
        }
        if (executionId == null || !executionId.equals(job.getExecutionId())
                || job.getLeaseExpiresAt() == null || !job.getLeaseExpiresAt().isAfter(clock.instant())
                || (job.getStatus() != JobStatus.PROCESSING && job.getStatus() != JobStatus.RUNNING)) {
            throw new BusinessException(
                    HttpStatus.CONFLICT, "STALE_EXECUTION_CALLBACK",
                    "Execution lease không còn hợp lệ cho inference");
        }
        return job;
    }

    private void verifyContext(JobContext context, UUID meetingId, UUID jobId) {
        if (context == null || !meetingId.equals(context.meetingId()) || !jobId.equals(context.jobId())
                || context.evidence() == null || context.evidence().isEmpty()
                || context.evidence().stream().noneMatch(item -> "TRANSCRIPT".equals(item.sourceType()))) {
            throw new BusinessException(
                    HttpStatus.CONFLICT, "AI_CONTEXT_INVALID", "Context không khớp Job hoặc thiếu Transcript");
        }
    }

    void verifyPreparation(
            PrepareResponse response, UUID requestId, UUID jobId, UUID meetingId, List<ContextEvidence> evidence) {
        if (response == null) {
            log.warn("AI prepare response invalid: field=response type=missing");
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY, "AI_PREPARE_RESPONSE_INVALID", "AI Engine trả contract không hợp lệ");
        }
        List<String> diagnostics = new ArrayList<>();
        if (!InternalLLMContracts.VERSION.equals(response.contractVersion()))
            diagnostics.add("contractVersion:" + (response.contractVersion() == null ? "missing" : "mismatch"));
        if (!requestId.equals(response.requestId()))
            diagnostics.add("requestId:" + (response.requestId() == null ? "missing" : "mismatch"));
        if (!jobId.equals(response.jobId()))
            diagnostics.add("jobId:" + (response.jobId() == null ? "missing" : "mismatch"));
        if (!meetingId.equals(response.meetingId()))
            diagnostics.add("meetingId:" + (response.meetingId() == null ? "missing" : "mismatch"));
        if (!TASK_TYPE.equals(response.taskType()))
            diagnostics.add("taskType:" + (response.taskType() == null ? "missing" : "mismatch"));
        if (!InternalLLMContracts.SUMMARY_SCHEMA_VERSION.equals(response.schemaVersion()))
            diagnostics.add("schemaVersion:" + (response.schemaVersion() == null ? "missing" : "mismatch"));
        if (response.systemPrompt() == null || response.systemPrompt().isBlank())
            diagnostics.add("systemPrompt:" + (response.systemPrompt() == null ? "missing" : "blank"));
        if (response.fallbackSystemPrompt() == null || response.fallbackSystemPrompt().isBlank())
            diagnostics.add("fallbackSystemPrompt:" + (response.fallbackSystemPrompt() == null ? "missing" : "blank"));
        if (response.prompt() == null || response.prompt().isBlank())
            diagnostics.add("prompt:" + (response.prompt() == null ? "missing" : "blank"));
        if (response.allowedSourceRefs() == null)
            diagnostics.add("allowedSourceRefs:missing");
        if (!diagnostics.isEmpty()) {
            log.warn("AI prepare response invalid: diagnostics={}", diagnostics);
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY, "AI_PREPARE_RESPONSE_INVALID", "AI Engine trả contract không hợp lệ");
        }
        List<ContextEvidence> orderedEvidence = evidence.stream()
                .sorted(Comparator.comparing(
                                ContextEvidence::startTimeMs,
                                Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(item -> item.sourceId() == null ? "" : item.sourceId().toString()))
                .toList();
        List<String> expectedRefs = new ArrayList<>(orderedEvidence.size());
        for (int index = 0; index < orderedEvidence.size(); index++) {
            expectedRefs.add("S" + (index + 1));
        }
        if (!expectedRefs.equals(response.allowedSourceRefs())) {
            log.warn("AI prepare response invalid: field=allowedSourceRefs type=mismatch");
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY, "AI_SOURCE_ALLOWLIST_INVALID",
                    "AI Engine source allowlist không khớp context đã xác minh");
        }
    }

    private List<String> originalSourceRefs(List<ContextEvidence> evidence) {
        return evidence.stream()
                .map(item -> item.sourceType() + ":" + item.sourceId())
                .toList();
    }

    private void verifyGeneration(GenerateResponse response, UUID requestId, UUID jobId, UUID meetingId) {
        if (response == null
                || !InternalLLMContracts.VERSION.equals(response.contractVersion())
                || !requestId.equals(response.requestId())
                || !jobId.equals(response.jobId())
                || !meetingId.equals(response.meetingId())
                || !TASK_TYPE.equals(response.taskType())
                || !"LOCAL".equals(response.provider())
                || !"SUCCESS".equals(response.status())
                || response.modelIdentifier() == null
                || response.result() == null
                || response.processingTimeMs() == null
                || response.processingTimeMs() < 0) {
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY, "AI_GENERATE_RESPONSE_INVALID", "AI Engine trả contract không hợp lệ");
        }
    }

    private void verifyValidation(ValidateResponse response, UUID requestId, UUID jobId, UUID meetingId) {
        if (response == null
                || !InternalLLMContracts.VERSION.equals(response.contractVersion())
                || !requestId.equals(response.requestId())
                || !jobId.equals(response.jobId())
                || !meetingId.equals(response.meetingId())
                || !TASK_TYPE.equals(response.taskType())
                || response.result() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY, "AI_VALIDATION_RESPONSE_INVALID",
                    "AI Engine validator trả contract không hợp lệ");
        }
    }

    private void validateSourceReferences(JsonNode summary, List<String> allowedRefs) {
        if (summary == null || !summary.isObject()) {
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY, "AI_SUMMARY_INVALID", "Summary phải là JSON object");
        }
        Set<String> allowed = Set.copyOf(allowedRefs);
        collectAndVerifyReferences(summary, allowed);
    }

    private void collectAndVerifyReferences(JsonNode node, Set<String> allowed) {
        if (node.isObject()) {
            node.fields().forEachRemaining(entry -> {
                JsonNode value = entry.getValue();
                if ("source_refs".equals(entry.getKey()) || "executive_summary_refs".equals(entry.getKey())) {
                    if (!value.isArray()) {
                        throw new BusinessException(
                                HttpStatus.BAD_GATEWAY, "AI_SOURCE_REFERENCES_INVALID",
                                "Source references phải là JSON array");
                    }
                    Set<String> seen = new HashSet<>();
                    for (JsonNode ref : value) {
                        if (!ref.isTextual() || !allowed.contains(ref.asText())) {
                            throw new BusinessException(
                                    HttpStatus.BAD_GATEWAY, "AI_SOURCE_REFERENCE_UNKNOWN",
                                    "AI Result chứa source reference không thuộc context");
                        }
                        if (!seen.add(ref.asText())) {
                            throw new BusinessException(
                                    HttpStatus.BAD_GATEWAY, "AI_SOURCE_REFERENCE_DUPLICATE",
                                    "AI Result chứa source reference bị lặp trong một claim");
                        }
                    }
                } else {
                    collectAndVerifyReferences(value, allowed);
                }
            });
        } else if (node.isArray()) {
            node.forEach(child -> collectAndVerifyReferences(child, allowed));
        }
    }

    private AIResponse toBackendResponse(
            UUID jobId,
            UUID meetingId,
            UUID requestId,
            String provider,
            String model,
            boolean fallbackUsed,
            String fallbackReason,
            int retries,
            Long latencyMs,
            TokenMetadata metadata,
            JsonNode meetingSummary) {
        String executiveSummary = meetingSummary.path("executive_summary").asText(null);
        if (executiveSummary == null || executiveSummary.isBlank()) {
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY, "AI_SUMMARY_INVALID",
                    "Backend yêu cầu executive summary không rỗng");
        }
        JsonNode sourceItems = meetingSummary.path("action_items");
        if (!sourceItems.isArray()) {
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY, "AI_ACTION_ITEMS_INVALID",
                    "Meeting summary thiếu action_items array");
        }

        ObjectNode result = objectMapper.createObjectNode();
        result.put("executiveSummary", executiveSummary);
        result.set("meetingSummary", meetingSummary.deepCopy());
        ArrayNode actionItems = result.putArray("actionItems");
        for (JsonNode sourceItem : sourceItems) {
            String title = sourceItem.path("title").asText(null);
            if (title == null || title.isBlank()) {
                throw new BusinessException(
                        HttpStatus.BAD_GATEWAY, "AI_ACTION_ITEM_INVALID", "Action item thiếu title");
            }
            ObjectNode mapped = actionItems.addObject();
            mapped.put("taskName", title);
            setNullableText(mapped, "assigneeName", sourceItem.path("assignee"));
            String deadline = nullableText(sourceItem.path("deadline"));
            String dueDate = absoluteInstant(sourceItem.path("deadline"));
            mapped.put("dueDate", dueDate);
            String deadlineRaw = nullableText(sourceItem.path("deadline_raw"));
            if (deadlineRaw == null && dueDate == null) {
                deadlineRaw = deadline;
            }
            mapped.put("deadlineRaw", deadlineRaw);

            JsonNode refs = sourceItem.path("source_refs");
            mapped.set("sourceRefs", refs.deepCopy());
            String transcriptId = singleTranscriptReference(refs);
            if (transcriptId == null) {
                mapped.putNull("sourceTranscriptId");
            } else {
                mapped.put("sourceTranscriptId", transcriptId);
            }
        }

        return AIResponse.builder()
                .jobId(jobId)
                .meetingId(meetingId)
                .requestId(requestId)
                .taskType(TASK_TYPE)
                .provider(provider)
                .model(model)
                .fallbackUsed(fallbackUsed)
                .fallbackReason(fallbackReason)
                .retryCount(retries)
                .latencyMs(latencyMs)
                .status("SUCCESS")
                .result(result)
                .inputTokens(metadata == null ? null : metadata.inputTokens())
                .outputTokens(metadata == null ? null : metadata.outputTokens())
                .tokenSource(metadata == null || metadata.source() == null
                        ? "unavailable" : metadata.source())
                .estimatedCost(null)
                .build();
    }

    private void setNullableText(ObjectNode target, String field, JsonNode value) {
        String text = nullableText(value);
        if (text == null) {
            target.putNull(field);
        } else {
            target.put(field, text);
        }
    }

    private String nullableText(JsonNode value) {
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }

    private String absoluteInstant(JsonNode deadline) {
        String text = nullableText(deadline);
        if (text == null) {
            return null;
        }
        try {
            return OffsetDateTime.parse(text).toInstant().toString();
        } catch (DateTimeParseException ex) {
            try {
                return Instant.parse(text).toString();
            } catch (DateTimeParseException ignored) {
                return null;
            }
        }
    }

    private String singleTranscriptReference(JsonNode refs) {
        if (refs == null || !refs.isArray() || refs.size() != 1 || !refs.get(0).isTextual()) {
            return null;
        }
        String ref = refs.get(0).asText();
        if (!ref.startsWith("TRANSCRIPT:")) {
            return null;
        }
        String id = ref.substring("TRANSCRIPT:".length());
        try {
            return UUID.fromString(id).toString();
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private UUID stableRequestId(UUID jobId) {
        return UUID.nameUUIDFromBytes((TASK_NAMESPACE + jobId + ":" + TASK_TYPE)
                .getBytes(StandardCharsets.UTF_8));
    }

    private synchronized boolean isLocalCircuitOpen() {
        return localCircuitOpenUntilNanos > System.nanoTime();
    }

    private synchronized void recordLocalFailure() {
        localFailures++;
        if (localFailures >= Math.max(1, properties.getLocalCircuitFailureThreshold())) {
            localCircuitOpenUntilNanos = System.nanoTime()
                    + Math.max(1, properties.getLocalCircuitOpenMs()) * 1_000_000L;
        }
    }

    private synchronized void recordLocalSuccess() {
        localFailures = 0;
        localCircuitOpenUntilNanos = 0;
    }

    private void sleepBeforeRetry(int attempt) {
        long backoff = Math.max(0, properties.getLocalRetryBackoffMs());
        long delay = Math.min(2_000, backoff * (1L << Math.min(attempt - 1, 4)));
        if (delay == 0) {
            return;
        }
        try {
            Thread.sleep(delay);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new BusinessException(
                    HttpStatus.SERVICE_UNAVAILABLE, "AI_RETRY_INTERRUPTED",
                    "Local inference retry bị gián đoạn");
        }
    }

    private BusinessException inferenceFailure(String code, RuntimeException cause) {
        HttpStatus status = cause instanceof GeminiFallbackService.GeminiFallbackDeniedException
                ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY;
        return new BusinessException(status, code, cause.getMessage());
    }
}
