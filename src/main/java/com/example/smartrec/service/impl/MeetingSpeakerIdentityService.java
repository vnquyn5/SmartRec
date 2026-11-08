package com.example.smartrec.service.impl;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.entity.Transcript;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.repository.TranscriptRepository;

import lombok.RequiredArgsConstructor;

/** Resolves diarization labels to stable, meeting-scoped speaker identities. */
@Service
@RequiredArgsConstructor
public class MeetingSpeakerIdentityService {
    private static final double MIN_LEGACY_OVERLAP_RATIO = 0.90;
    private static final double MIN_LEGACY_OVERLAP_SECONDS = 1.0;
    private static final Pattern RAW_SPEAKER_ID = Pattern.compile("(?i)^speaker_(\\d+)$");
    private static final Pattern DISPLAY_SPEAKER_ID = Pattern.compile("(?i)^speaker[\\s-]*(\\d+)$");

    private final SpeakerRepository speakerRepository;
    private final SpeakerSegmentRepository speakerSegmentRepository;
    private final TranscriptRepository transcriptRepository;

    public Mapping forMeeting(UUID meetingId) {
        List<Speaker> speakers = speakerRepository.findByMeetingId(meetingId);
        List<SpeakerSegment> timeline = speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(meetingId);
        List<Transcript> transcripts = transcriptRepository.findByMeetingIdOrderByStartTimeMsAsc(meetingId);
        List<TranscriptEvidence> evidence = transcripts.stream()
                .map(item -> new TranscriptEvidence(item.getMeetingId(), item.getSpeakerId(),
                        item.getAttributionStatus(), item.getStartTimeMs(), item.getEndTimeMs()))
                .toList();
        return resolve(meetingId, speakers, timeline, evidence);
    }

    public static Mapping resolve(
            UUID meetingId,
            List<Speaker> speakers,
            List<SpeakerSegment> timeline,
            List<TranscriptEvidence> transcripts) {
        List<Speaker> orderedSpeakers = speakers.stream()
                .filter(speaker -> meetingId.equals(speaker.getMeetingId()))
                .sorted(Comparator.comparingInt((Speaker speaker) -> speakerIndex(speaker.getAiLabel()))
                        .thenComparing(speaker -> normalizeLabel(speaker.getAiLabel())))
                .toList();
        Map<UUID, Identity> byId = new HashMap<>();
        Map<String, Speaker> speakersByLabel = new HashMap<>();
        for (int offset = 0; offset < orderedSpeakers.size(); offset++) {
            Speaker speaker = orderedSpeakers.get(offset);
            int index = speakerIndex(speaker.getAiLabel());
            if (index < 1) index = offset + 1;
            byId.put(speaker.getId(), new Identity(
                    speaker.getId(), speaker.getAiLabel(), defaultName(speaker.getAiLabel(), index), index, false));
            String normalized = normalizeLabel(speaker.getAiLabel());
            if (!normalized.isEmpty()) speakersByLabel.put(normalized, speaker);
        }

        Map<String, UUID> legacySpeakerIds = resolveLegacyLabels(
                meetingId, timeline, transcripts, byId.keySet(), speakersByLabel.keySet());
        for (Speaker speaker : orderedSpeakers) {
            Identity current = byId.get(speaker.getId());
            String persistedName = nonBlank(speaker.getRealName());
            String displayName = persistedName != null ? persistedName : current.displayName();
            byId.put(speaker.getId(), new Identity(
                    current.speakerId(), current.aiLabel(), displayName, current.speakerIndex(), persistedName != null));
        }

        Map<String, Identity> byTimelineLabel = new HashMap<>();
        speakersByLabel.forEach((label, speaker) -> byTimelineLabel.put(label, byId.get(speaker.getId())));
        legacySpeakerIds.forEach((label, speakerId) -> {
            Identity identity = byId.get(speakerId);
            if (identity != null) byTimelineLabel.put(label, identity);
        });
        return new Mapping(Map.copyOf(byId), Map.copyOf(byTimelineLabel), List.copyOf(byId.values()), List.copyOf(timeline));
    }

    private static Map<String, UUID> resolveLegacyLabels(
            UUID meetingId,
            List<SpeakerSegment> timeline,
            List<TranscriptEvidence> transcripts,
            Set<UUID> validSpeakerIds,
            Set<String> canonicalLabels) {
        Map<String, Map<UUID, Double>> overlapByLabel = new HashMap<>();
        for (SpeakerSegment turn : timeline) {
            if (turn.getSpeakerLabel() == null || turn.getStartTime() == null || turn.getEndTime() == null
                    || turn.getEndTime() <= turn.getStartTime()) continue;
            String label = normalizeLabel(turn.getSpeakerLabel());
            if (label.isEmpty() || canonicalLabels.contains(label)) continue;
            Map<UUID, List<double[]>> intervalsBySpeaker = new HashMap<>();
            for (TranscriptEvidence transcript : transcripts) {
                UUID speakerId = transcript.speakerId();
                if (!meetingId.equals(transcript.meetingId()) || speakerId == null
                        || !validSpeakerIds.contains(speakerId)
                        || !"ATTRIBUTED".equals(transcript.attributionStatus())
                        || transcript.startTimeMs() == null || transcript.endTimeMs() == null) continue;
                double start = Math.max(turn.getStartTime(), transcript.startTimeMs() / 1000.0);
                double end = Math.min(turn.getEndTime(), transcript.endTimeMs() / 1000.0);
                if (end > start) intervalsBySpeaker.computeIfAbsent(speakerId, ignored -> new ArrayList<>())
                        .add(new double[]{start, end});
            }
            intervalsBySpeaker.forEach((speakerId, intervals) -> overlapByLabel
                    .computeIfAbsent(label, ignored -> new HashMap<>())
                    .merge(speakerId, unionDuration(intervals), Double::sum));
        }

        Map<String, UUID> resolved = new HashMap<>();
        overlapByLabel.forEach((label, scores) -> {
            double total = scores.values().stream().mapToDouble(Double::doubleValue).sum();
            if (total < MIN_LEGACY_OVERLAP_SECONDS || scores.isEmpty()) return;
            var winner = scores.entrySet().stream()
                    .max(Map.Entry.comparingByValue())
                    .orElse(null);
            if (winner != null && winner.getValue() >= MIN_LEGACY_OVERLAP_SECONDS
                    && winner.getValue() / total >= MIN_LEGACY_OVERLAP_RATIO) {
                resolved.put(label, winner.getKey());
            }
        });
        return resolved;
    }

    private static double unionDuration(List<double[]> intervals) {
        if (intervals.isEmpty()) return 0.0;
        intervals.sort(Comparator.comparingDouble(interval -> interval[0]));
        double start = intervals.get(0)[0];
        double end = intervals.get(0)[1];
        double total = 0.0;
        for (int index = 1; index < intervals.size(); index++) {
            double[] interval = intervals.get(index);
            if (interval[0] <= end) end = Math.max(end, interval[1]);
            else {
                total += end - start;
                start = interval[0];
                end = interval[1];
            }
        }
        return total + end - start;
    }

    private static String normalizeLabel(String value) {
        String normalized = nonBlank(value);
        if (normalized == null) return "";
        String trimmed = normalized.trim();
        Matcher raw = RAW_SPEAKER_ID.matcher(trimmed);
        if (raw.matches()) {
            try { return "SPEAKER " + (Integer.parseInt(raw.group(1)) + 1); }
            catch (NumberFormatException ignored) { return trimmed.toUpperCase(Locale.ROOT); }
        }
        return Normalizer.normalize(trimmed, Normalizer.Form.NFC).toUpperCase(Locale.ROOT);
    }

    private static int speakerIndex(String label) {
        if (label == null) return -1;
        Matcher raw = RAW_SPEAKER_ID.matcher(label.trim());
        Matcher display = DISPLAY_SPEAKER_ID.matcher(label.trim());
        try {
            if (raw.matches()) return Integer.parseInt(raw.group(1)) + 1;
            if (display.matches()) return Integer.parseInt(display.group(1));
        } catch (NumberFormatException ignored) {
            return -1;
        }
        return -1;
    }

    private static String defaultName(String aiLabel, int index) {
        int parsed = speakerIndex(aiLabel);
        return "Speaker " + (parsed > 0 ? parsed : index);
    }

    private static String nonBlank(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    public record Identity(UUID speakerId, String aiLabel, String displayName, int speakerIndex, boolean confirmed) {}

    public record TranscriptEvidence(
            UUID meetingId, UUID speakerId, String attributionStatus, Long startTimeMs, Long endTimeMs) {}

    public record Mapping(
            Map<UUID, Identity> byId,
            Map<String, Identity> byTimelineLabel,
            List<Identity> speakers,
            List<SpeakerSegment> timeline) {
        public Identity forId(UUID speakerId) { return speakerId == null ? null : byId.get(speakerId); }
        public Identity forTimelineLabel(String label) { return byTimelineLabel.get(normalizeLabel(label)); }
    }
}
