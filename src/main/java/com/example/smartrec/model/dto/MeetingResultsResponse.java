package com.example.smartrec.model.dto;

import java.time.Instant;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.List;

import com.example.smartrec.enums.JobStatus;
import com.fasterxml.jackson.databind.JsonNode;

public record MeetingResultsResponse(
        UUID meetingId,
        UUID jobId,
        JobStatus jobStatus,
        List<TranscriptResult> transcripts,
        SummaryResult summary,
        List<ActionItemResult> actionItems,
        String llmStatus,
        String llmFailureCode,
        Boolean llmFallbackUsed,
        String llmProvider) {

    public record TranscriptResult(
            UUID id,
            UUID speakerId,
            String speakerLabel,
            String attributionStatus,
            Long startTimeMs,
            Long endTimeMs,
            String textContent,
            BigDecimal confidenceScore,
            UUID meetingId,
            UUID jobId) {}

    public record SummaryResult(String executiveSummary, JsonNode details) {}

    public record ActionItemResult(
            UUID id,
            String title,
            String assigneeName,
            UUID assigneeSpeakerId,
            String assignmentProvenance,
            String status,
            Instant dueDate,
            String deadlineRaw,
            UUID sourceTranscriptId,
            List<String> sourceRefs) {}
}
