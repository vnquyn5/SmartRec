package com.example.smartrec.controller;

import java.util.List;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.Comparator;
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
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.JobService;
import com.example.smartrec.service.MeetingService;
import com.example.smartrec.service.TranscriptService;
import com.example.smartrec.service.impl.MeetingSpeakerIdentityService;
import com.example.smartrec.service.impl.ActionItemAssigneeResolver;
import com.fasterxml.jackson.databind.JsonNode;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/meetings/{meetingId}/jobs/{jobId}/results")
@RequiredArgsConstructor
public class MeetingResultsController {
    private static final double MIN_SPEAKER_COVERAGE = 0.90;
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
        if (!speakerIds.isEmpty()) {
            List<com.example.smartrec.entity.Speaker> existingSpeakers = speakerRepository.findAllById(speakerIds);
            existingSpeakers.forEach(speaker -> {
                if (!meetingId.equals(speaker.getMeetingId())) {
                    throw inconsistentData();
                }
            });
            if (existingSpeakers.size() != speakerIds.size()) throw inconsistentData();
        }
        Map<UUID, com.example.smartrec.entity.Speaker> meetingSpeakerById = new HashMap<>();
        speakerRepository.findByMeetingId(meetingId).forEach(speaker -> meetingSpeakerById.put(speaker.getId(), speaker));
        if (!speakerIds.isEmpty()) {
            speakerRepository.findAllById(speakerIds).forEach(speaker -> meetingSpeakerById.putIfAbsent(speaker.getId(), speaker));
        }
        List<com.example.smartrec.entity.Speaker> meetingSpeakers = List.copyOf(meetingSpeakerById.values());
        if (meetingSpeakers.stream().anyMatch(speaker -> !meetingId.equals(speaker.getMeetingId()))) {
            throw inconsistentData();
        }
        List<com.example.smartrec.entity.SpeakerSegment> speakerTimeline =
                speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(meetingId);
        List<MeetingSpeakerIdentityService.TranscriptEvidence> identityEvidence = persistedTranscripts.stream()
                .map(item -> new MeetingSpeakerIdentityService.TranscriptEvidence(
                        item.getMeetingId(), item.getSpeakerId(), item.getAttributionStatus(),
                        item.getStartTimeMs(), item.getEndTimeMs()))
                .toList();
        MeetingSpeakerIdentityService.Mapping identities = MeetingSpeakerIdentityService.resolve(
                meetingId, meetingSpeakers, speakerTimeline, identityEvidence);
        List<TranscriptResult> transcripts = persistedTranscripts.stream()
                .map(item -> toTranscriptResult(item, identities))
                .toList();

        Summary summaryEntity = summaryRepository.findByProcessingJobId(jobId).orElse(null);
        SummaryResult summary = summaryEntity == null ? null : toSummary(meetingId, summaryEntity);
        List<ActionItemResult> actionItems = actionItemRepository.findByProcessingJobId(jobId).stream()
                .map(item -> toActionItem(meetingId, jobId, item, identities, persistedTranscripts))
                .toList();

        return ResponseEntity.ok(new MeetingResultsResponse(
                meetingId, jobId, job.getStatus(), transcripts, summary, actionItems));
    }

    private TranscriptResult toTranscriptResult(
            TranscriptResponse item,
            MeetingSpeakerIdentityService.Mapping identities) {
        String storedStatus = item.getAttributionStatus() == null ? "ATTRIBUTED" : item.getAttributionStatus();
        UUID speakerId = item.getSpeakerId();
        MeetingSpeakerIdentityService.Identity identity = identities.forId(speakerId);
        String speakerLabel = identity == null ? null : identity.displayName();
        String attributionStatus = storedStatus;

        if ("CROSS_SPEAKER_BOUNDARY".equals(storedStatus)) {
            speakerId = null;
            speakerLabel = null;
        } else if ("UNRESOLVED".equals(storedStatus)) {
            TimelineAttribution timeline = findTimelineAttribution(item, identities);
            if (timeline.speakerId() != null && timeline.coverage() >= MIN_SPEAKER_COVERAGE
                    && !timeline.hasUnmappedOverlap()) {
                speakerId = timeline.speakerId();
                identity = identities.forId(speakerId);
                speakerLabel = identity == null ? null : identity.displayName();
                attributionStatus = identity == null ? "UNRESOLVED" : "ATTRIBUTED";
                if (identity == null) speakerId = null;
            } else {
                speakerId = null;
                speakerLabel = null;
            }
        } else if (identity == null) {
            speakerId = null;
            speakerLabel = null;
            attributionStatus = "UNRESOLVED";
        }

        return new TranscriptResult(item.getId(), speakerId, speakerLabel, attributionStatus,
                item.getStartTimeMs(), item.getEndTimeMs(), item.getTextContent(),
                item.getConfidenceScore(), item.getMeetingId(), item.getProcessingJobId());
    }

    private TimelineAttribution findTimelineAttribution(
            TranscriptResponse item,
            MeetingSpeakerIdentityService.Mapping identities) {
        if (item.getStartTimeMs() == null || item.getEndTimeMs() == null
                || item.getEndTimeMs() <= item.getStartTimeMs()) {
            return new TimelineAttribution(null, 0.0, false);
        }
        double start = item.getStartTimeMs() / 1000.0;
        double end = item.getEndTimeMs() / 1000.0;
        Map<UUID, List<double[]>> intervalsBySpeaker = new HashMap<>();
        boolean hasUnmappedOverlap = false;
        for (var turn : identities.timeline()) {
            if (turn.getStartTime() == null || turn.getEndTime() == null
                    || turn.getStartTime() >= end || turn.getEndTime() <= start) continue;
            MeetingSpeakerIdentityService.Identity speaker = identities.forTimelineLabel(turn.getSpeakerLabel());
            if (speaker == null) {
                hasUnmappedOverlap = true;
                continue;
            }
            intervalsBySpeaker.computeIfAbsent(speaker.speakerId(), ignored -> new ArrayList<>())
                    .add(new double[]{Math.max(start, turn.getStartTime()), Math.min(end, turn.getEndTime())});
        }
        if (intervalsBySpeaker.size() > 1) {
            return new TimelineAttribution(null, 0.0, hasUnmappedOverlap);
        }
        if (hasUnmappedOverlap || intervalsBySpeaker.isEmpty()) {
            return new TimelineAttribution(null, 0.0, hasUnmappedOverlap);
        }
        var entry = intervalsBySpeaker.entrySet().iterator().next();
        List<double[]> intervals = entry.getValue();
        intervals.sort(Comparator.comparingDouble(interval -> interval[0]));
        double covered = 0.0;
        double coveredStart = intervals.get(0)[0];
        double coveredEnd = intervals.get(0)[1];
        for (int index = 1; index < intervals.size(); index++) {
            double[] interval = intervals.get(index);
            if (interval[0] <= coveredEnd) coveredEnd = Math.max(coveredEnd, interval[1]);
            else {
                covered += coveredEnd - coveredStart;
                coveredStart = interval[0];
                coveredEnd = interval[1];
            }
        }
        covered += coveredEnd - coveredStart;
        return new TimelineAttribution(entry.getKey(), covered / (end - start), false);
    }

    private record TimelineAttribution(UUID speakerId, double coverage, boolean hasUnmappedOverlap) {}

    private SummaryResult toSummary(UUID meetingId, Summary summary) {
        if (!meetingId.equals(summary.getMeetingId())) {
            throw inconsistentData();
        }
        JsonNode raw = summary.getRawLlmResponse();
        JsonNode details = raw == null ? null : raw.path("meetingSummary");
        return new SummaryResult(summary.getExecutiveSummary(), details);
    }

    private ActionItemResult toActionItem(
            UUID meetingId,
            UUID jobId,
            ActionItem item,
            MeetingSpeakerIdentityService.Mapping identities,
            List<TranscriptResponse> transcripts) {
        if (!meetingId.equals(item.getMeetingId())) {
            throw inconsistentData();
        }
        String assigneeName = item.getAssigneeName();
        UUID assigneeSpeakerId = item.getAssigneeSpeakerId();
        String provenance = item.getAssignmentProvenance();
        boolean userConfirmed = item.getAssigneeUserId() != null || "USER_CONFIRMED".equals(provenance);
        if (!userConfirmed && assigneeSpeakerId == null && (assigneeName == null || assigneeName.isBlank())) {
            assigneeSpeakerId = resolveFirstPersonAssignee(meetingId, jobId, item, identities, transcripts);
            if (assigneeSpeakerId != null) provenance = "FIRST_PERSON_COMMITMENT";
        }
        MeetingSpeakerIdentityService.Identity assignee = identities.forId(assigneeSpeakerId);
        if (assigneeSpeakerId != null && assignee == null) throw inconsistentData();
        if (item.getAssigneeUserId() == null && assignee != null) {
            // The speaker UUID is the durable link. Render its current meeting-scoped
            // name so a later rename updates both Transcript and Action Items.
            assigneeName = assignee.displayName();
        }
        return new ActionItemResult(
                item.getId(),
                item.getTaskName(),
                assigneeName,
                assigneeSpeakerId,
                provenance,
                item.getStatus(),
                item.getDueDate(),
                item.getDeadlineRaw(),
                item.getSourceTranscriptId(),
                item.getSourceRefs() == null ? List.of() : List.copyOf(item.getSourceRefs()));
    }

    private UUID resolveFirstPersonAssignee(
            UUID meetingId,
            UUID jobId,
            ActionItem item,
            MeetingSpeakerIdentityService.Mapping identities,
            List<TranscriptResponse> transcripts) {
        if (item.getSourceRefs() == null || item.getSourceRefs().isEmpty()) return null;
        Map<UUID, TranscriptResponse> transcriptsById = transcripts.stream()
                .collect(Collectors.toMap(TranscriptResponse::getId, transcript -> transcript, (left, right) -> left));
        Set<UUID> citedIds = new java.util.LinkedHashSet<>();
        for (String sourceRef : item.getSourceRefs()) {
            if (sourceRef == null || !sourceRef.startsWith("TRANSCRIPT:")) continue;
            try {
                citedIds.add(UUID.fromString(sourceRef.substring("TRANSCRIPT:".length())));
            } catch (IllegalArgumentException ignored) {
                return null;
            }
        }
        if (citedIds.isEmpty()) return null;

        UUID speakerId = null;
        boolean explicitCommitment = false;
        for (UUID transcriptId : citedIds) {
            TranscriptResponse transcript = transcriptsById.get(transcriptId);
            if (transcript == null || !meetingId.equals(transcript.getMeetingId())
                    || !jobId.equals(transcript.getProcessingJobId())
                    || !"ATTRIBUTED".equals(transcript.getAttributionStatus())
                    || transcript.getSpeakerId() == null) return null;
            if (speakerId == null) speakerId = transcript.getSpeakerId();
            else if (!speakerId.equals(transcript.getSpeakerId())) return null;
            explicitCommitment |= ActionItemAssigneeResolver.hasExplicitFirstPersonCommitment(
                    transcript.getTextContent());
        }
        MeetingSpeakerIdentityService.Identity identity = identities.forId(speakerId);
        return explicitCommitment && identity != null ? speakerId : null;
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
