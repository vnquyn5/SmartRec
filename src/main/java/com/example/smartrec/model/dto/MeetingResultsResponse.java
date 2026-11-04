package com.example.smartrec.model.dto;

import java.time.Instant;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

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
        String ocrStatus,
        List<SlideResult> slides) {

    public record TranscriptResult(
            UUID id,
            UUID speakerId,
            String speakerLabel,
            Long startTimeMs,
            Long endTimeMs,
            String textContent,
            BigDecimal confidenceScore) {}

    public record SummaryResult(String executiveSummary, JsonNode details) {}

    public record SlideResult(
            UUID slideId,
            Long timestampMs,
            String objectKey,
            String ocrText,
            String topic,
            List<String> keywords) {}

    public record ActionItemResult(
            UUID id,
            String title,
            String assigneeName,
            String status,
            Instant dueDate,
            String deadlineRaw,
            UUID sourceTranscriptId) {}
}
