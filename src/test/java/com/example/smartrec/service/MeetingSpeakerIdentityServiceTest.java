package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.service.impl.MeetingSpeakerIdentityService;

class MeetingSpeakerIdentityServiceTest {
    private final UUID meetingId = UUID.randomUUID();
    private final UUID speakerOneId = UUID.randomUUID();
    private final UUID speakerTwoId = UUID.randomUUID();

    @Test
    void resolvesLegacyDisplayAliasOnlyFromStrongUnambiguousAttributedEvidence() {
        Speaker speakerOne = speaker(speakerOneId, "SPEAKER 1");
        Speaker speakerTwo = speaker(speakerTwoId, "SPEAKER 2");
        List<SpeakerSegment> timeline = List.of(
                turn("Minh", 0.0, 2.0), turn("Minh", 4.0, 6.0), turn("Speaker 2", 6.0, 8.0));
        List<MeetingSpeakerIdentityService.TranscriptEvidence> evidence = List.of(
                evidence(speakerOneId, "ATTRIBUTED", 0L, 2000L),
                evidence(speakerOneId, "ATTRIBUTED", 4000L, 6000L));

        var mapping = MeetingSpeakerIdentityService.resolve(meetingId,
                List.of(speakerOne, speakerTwo), timeline, evidence);

        assertEquals(speakerOneId, mapping.forTimelineLabel("Minh").speakerId());
        assertEquals("Speaker 1", mapping.forId(speakerOneId).displayName());
        assertEquals(false, mapping.forId(speakerOneId).confirmed());
        assertEquals(speakerTwoId, mapping.forTimelineLabel("Speaker 2").speakerId());
    }

    @Test
    void leavesLegacyAliasUnresolvedWhenAttributedEvidenceConflicts() {
        List<SpeakerSegment> timeline = List.of(turn("Minh", 0.0, 2.0));
        List<MeetingSpeakerIdentityService.TranscriptEvidence> evidence = List.of(
                evidence(speakerOneId, "ATTRIBUTED", 0L, 1000L),
                evidence(speakerTwoId, "ATTRIBUTED", 1000L, 2000L));

        var mapping = MeetingSpeakerIdentityService.resolve(meetingId,
                List.of(speaker(speakerOneId, "SPEAKER 1"), speaker(speakerTwoId, "SPEAKER 2")),
                timeline, evidence);

        assertNull(mapping.forTimelineLabel("Minh"));
        assertEquals("Speaker 1", mapping.forId(speakerOneId).displayName());
    }

    @Test
    void resolvesLegacyRenameLabelsFromPersistedTranscriptIdsForTheCurrentMeeting() {
        List<Speaker> speakers = List.of(
                speaker(speakerOneId, "SPEAKER 1"), speaker(speakerTwoId, "SPEAKER 2"));
        List<SpeakerSegment> timeline = List.of(
                turn("Anh Quyền", 0.031, 5.296),
                turn("Nguyễn Văn A", 5.482, 11.540),
                turn("Speaker 3", 11.692, 13.463));
        List<MeetingSpeakerIdentityService.TranscriptEvidence> evidence = List.of(
                evidence(speakerOneId, "ATTRIBUTED", 0L, 5240L),
                evidence(speakerTwoId, "ATTRIBUTED", 5480L, 11460L));

        var mapping = MeetingSpeakerIdentityService.resolve(meetingId, speakers, timeline, evidence);

        assertEquals(speakerOneId, mapping.forTimelineLabel("Anh Quyền").speakerId());
        assertEquals("Speaker 1", mapping.forId(speakerOneId).displayName());
        assertEquals(false, mapping.forId(speakerOneId).confirmed());
        assertEquals(speakerTwoId, mapping.forTimelineLabel("Nguyễn Văn A").speakerId());
    }

    @Test
    void onlyPersistedRealNameConfirmsSpeakerIdentity() {
        Speaker speaker = speaker(speakerOneId, "SPEAKER 1");
        speaker.setRealName("Minh");
        List<SpeakerSegment> timeline = List.of(turn("Legacy alias", 0.0, 2.0));
        List<MeetingSpeakerIdentityService.TranscriptEvidence> evidence = List.of(
                evidence(speakerOneId, "ATTRIBUTED", 0L, 2000L));

        var mapping = MeetingSpeakerIdentityService.resolve(meetingId,
                List.of(speaker), timeline, evidence);

        assertEquals(speakerOneId, mapping.forTimelineLabel("Legacy alias").speakerId());
        assertEquals("Minh", mapping.forId(speakerOneId).displayName());
        assertEquals(true, mapping.forId(speakerOneId).confirmed());
    }

    private Speaker speaker(UUID id, String aiLabel) {
        Speaker speaker = new Speaker();
        speaker.setId(id);
        speaker.setMeetingId(meetingId);
        speaker.setAiLabel(aiLabel);
        return speaker;
    }

    private SpeakerSegment turn(String label, double start, double end) {
        return SpeakerSegment.builder().meetingId(meetingId).speakerLabel(label).startTime(start).endTime(end).build();
    }

    private MeetingSpeakerIdentityService.TranscriptEvidence evidence(
            UUID speakerId, String status, long startMs, long endMs) {
        return new MeetingSpeakerIdentityService.TranscriptEvidence(meetingId, speakerId, status, startMs, endMs);
    }
}
