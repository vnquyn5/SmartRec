package com.example.smartrec.controller;

import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.entity.Speaker;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.model.dto.MeetingResultsResponse;
import com.example.smartrec.model.dto.MeetingResultsResponse.ActionItemResult;
import com.example.smartrec.model.dto.MeetingResultsResponse.SummaryResult;
import com.example.smartrec.model.dto.MeetingResultsResponse.TranscriptResult;
import com.example.smartrec.model.dto.TranscriptResponse;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.JobService;
import com.example.smartrec.service.MeetingService;
import com.example.smartrec.service.TranscriptService;
import com.fasterxml.jackson.databind.JsonNode;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/meetings/{meetingId}/jobs/{jobId}/results")
@RequiredArgsConstructor
public class MeetingResultsController {
    private final MeetingService meetingService;
    private final JobService jobService;
    private final TranscriptService transcriptService;
    private final SummaryRepository summaryRepository;
    private final ActionItemRepository actionItemRepository;
    private final SpeakerRepository speakerRepository;
    private final SpeakerSegmentRepository speakerSegmentRepository;

    @GetMapping
    public ResponseEntity<MeetingResultsResponse> getResults(
            @PathVariable UUID meetingId,
            @PathVariable UUID jobId) {
        meetingService.getMeeting(meetingId);
        JobResponse job = jobService.getJobForCurrentUser(jobId);
        if (job == null || !meetingId.equals(job.getMeetingId())) {
            throw notFound();
        }

        List<TranscriptResponse> persistedTranscripts = transcriptService.getTranscriptsByJob(jobId);
        if (persistedTranscripts.stream().anyMatch(item -> !meetingId.equals(item.getMeetingId()))) {
            throw inconsistentData();
        }
        Set<UUID> speakerIds = persistedTranscripts.stream()
                .map(TranscriptResponse::getSpeakerId)
                .filter(Objects::nonNull)
                .distinct()
                .collect(Collectors.toSet());
        Map<UUID, String> speakerLabels = new HashMap<>();
        if (!speakerIds.isEmpty()) {
            speakerRepository.findAllById(speakerIds).forEach(speaker -> {
                if (!meetingId.equals(speaker.getMeetingId())) {
                    throw inconsistentData();
                }
                speakerLabels.put(speaker.getId(),
                        speaker.getRealName() == null || speaker.getRealName().isBlank()
                                ? speaker.getAiLabel()
                                : speaker.getRealName());
            });
        }
        List<com.example.smartrec.entity.SpeakerSegment> speakerTimeline =
                speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(meetingId);
        Map<String, Speaker> speakersByAiLabel = new HashMap<>();
        if (!speakerTimeline.isEmpty()) {
            speakerRepository.findByMeetingId(meetingId).forEach(speaker -> {
                if (!meetingId.equals(speaker.getMeetingId())) {
                    throw inconsistentData();
                }
                speakersByAiLabel.put(normalizeSpeakerLabel(speaker.getAiLabel()), speaker);
            });
        }
        List<TranscriptResult> transcripts = persistedTranscripts.stream()
                .map(item -> toTranscriptResult(item, speakerLabels, speakersByAiLabel, speakerTimeline))
                .toList();

        Summary summaryEntity = summaryRepository.findByProcessingJobId(jobId).orElse(null);
        SummaryResult summary = summaryEntity == null ? null : toSummary(meetingId, summaryEntity);
        List<ActionItemResult> actionItems = actionItemRepository.findByProcessingJobId(jobId).stream()
                .map(item -> toActionItem(meetingId, item, summaryEntity))
                .toList();

        return ResponseEntity.ok(new MeetingResultsResponse(
                meetingId, jobId, job.getStatus(), transcripts, summary, actionItems));
    }

    private TranscriptResult toTranscriptResult(
            TranscriptResponse item,
            Map<UUID, String> persistedSpeakerLabels,
            Map<String, Speaker> speakersByAiLabel,
            List<com.example.smartrec.entity.SpeakerSegment> speakerTimeline) {
        String storedStatus = item.getAttributionStatus() == null
                ? "ATTRIBUTED" : item.getAttributionStatus();
        UUID speakerId = item.getSpeakerId();
        String speakerLabel = persistedSpeakerLabels.get(speakerId);
        String attributionStatus = storedStatus;

        if ("CROSS_SPEAKER_BOUNDARY".equals(storedStatus) || "UNRESOLVED".equals(storedStatus)) {
            speakerId = null;
            speakerLabel = null;
        } else if (!speakerTimeline.isEmpty()
                && item.getStartTimeMs() != null && item.getEndTimeMs() != null
                && item.getEndTimeMs() > item.getStartTimeMs()) {
            double start = item.getStartTimeMs() / 1000.0;
            double end = item.getEndTimeMs() / 1000.0;
            List<com.example.smartrec.entity.SpeakerSegment> overlapping = speakerTimeline.stream()
                    .filter(turn -> turn.getStartTime() != null && turn.getEndTime() != null
                            && turn.getStartTime() < end && turn.getEndTime() > start)
                    .toList();
            var overlapLabels = overlapping.stream()
                    .map(turn -> normalizeSpeakerLabel(turn.getSpeakerLabel()))
                    .filter(label -> !label.isEmpty())
                    .collect(Collectors.toSet());
            if (overlapLabels.size() > 1) {
                attributionStatus = "CROSS_SPEAKER_BOUNDARY";
                speakerId = null;
                speakerLabel = null;
            } else {
                var containing = overlapping.stream()
                        .filter(turn -> turn.getStartTime() <= start && end <= turn.getEndTime())
                        .findFirst();
                if (containing.isEmpty()) {
                    attributionStatus = "UNRESOLVED";
                    speakerId = null;
                    speakerLabel = null;
                } else {
                    Speaker matchedSpeaker = speakersByAiLabel.get(
                            normalizeSpeakerLabel(containing.get().getSpeakerLabel()));
                    if (matchedSpeaker == null) {
                        attributionStatus = "UNRESOLVED";
                        speakerId = null;
                        speakerLabel = null;
                    } else {
                        attributionStatus = "ATTRIBUTED";
                        speakerId = matchedSpeaker.getId();
                        speakerLabel = matchedSpeaker.getRealName() == null
                                || matchedSpeaker.getRealName().isBlank()
                                ? matchedSpeaker.getAiLabel() : matchedSpeaker.getRealName();
                    }
                }
            }
        }

        return new TranscriptResult(
                item.getId(), speakerId, speakerLabel, attributionStatus,
                item.getStartTimeMs(), item.getEndTimeMs(), item.getTextContent(),
                item.getConfidenceScore(), item.getMeetingId(), item.getProcessingJobId());
    }

    private String normalizeSpeakerLabel(String label) {
        return label == null ? "" : label.trim().toUpperCase(java.util.Locale.ROOT);
    }

    private SummaryResult toSummary(UUID meetingId, Summary summary) {
        if (!meetingId.equals(summary.getMeetingId())) {
            throw inconsistentData();
        }
        JsonNode raw = summary.getRawLlmResponse();
        JsonNode details = raw == null ? null : raw.path("meetingSummary");
        return new SummaryResult(summary.getExecutiveSummary(), details);
    }

    private ActionItemResult toActionItem(UUID meetingId, ActionItem item, Summary summary) {
        if (!meetingId.equals(item.getMeetingId())) {
            throw inconsistentData();
        }
        String deadlineRaw = rawDeadline(summary, item);
        return new ActionItemResult(
                item.getId(),
                item.getTaskName(),
                item.getAssigneeName(),
                item.getStatus(),
                item.getDueDate(),
                deadlineRaw,
                item.getSourceTranscriptId());
    }

    private String rawDeadline(Summary summary, ActionItem item) {
        if (summary == null || item.getSourceTranscriptId() == null) {
            return null;
        }
        JsonNode actions = summary.getRawLlmResponse() == null
                ? null
                : summary.getRawLlmResponse().path("meetingSummary").path("action_items");
        if (actions == null || !actions.isArray()) {
            return null;
        }

        String expectedRef = "TRANSCRIPT:" + item.getSourceTranscriptId();
        String matchedDeadline = null;
        int matchCount = 0;
        for (JsonNode candidate : actions) {
            JsonNode refs = candidate.path("source_refs");
            if (!item.getTaskName().equals(candidate.path("title").asText(null))
                    || !refs.isArray()
                    || refs.size() != 1
                    || !expectedRef.equals(refs.get(0).asText(null))) {
                continue;
            }
            if (++matchCount > 1) {
                return null;
            }
            matchedDeadline = nonBlankText(candidate.path("deadline_raw"));
            if (matchedDeadline == null) {
                matchedDeadline = nonBlankText(candidate.path("deadline"));
            }
        }
        return matchedDeadline;
    }

    private String nonBlankText(JsonNode value) {
        return value != null && value.isTextual() && !value.asText().isBlank()
                ? value.asText()
                : null;
    }

    private BusinessException notFound() {
        return new BusinessException(HttpStatus.NOT_FOUND, "MEETING_JOB_NOT_FOUND",
                "Không tìm thấy Job thuộc cuộc họp");
    }

    private BusinessException inconsistentData() {
        return new BusinessException(HttpStatus.CONFLICT, "MEETING_RESULT_SCOPE_MISMATCH",
                "Dữ liệu kết quả không thuộc Meeting/Job được yêu cầu");
    }
}
