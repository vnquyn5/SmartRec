package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.RenameSpeakerRequest;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.impl.MeetingSpeakerIdentityService;
import com.example.smartrec.service.impl.MeetingSpeakerServiceImpl;

@ExtendWith(MockitoExtension.class)
class MeetingSpeakerServiceImplTest {
    private static final UUID MEETING_ID = UUID.randomUUID();
    private static final UUID SPEAKER_ID = UUID.randomUUID();

    @Mock private SpeakerSegmentRepository speakerSegmentRepository;
    @Mock private SpeakerRepository speakerRepository;
    @Mock private MeetingSpeakerIdentityService speakerIdentityService;
    @Mock private MeetingService meetingService;
    @InjectMocks private MeetingSpeakerServiceImpl service;

    @Test
    void renameUpdatesOnlyCanonicalDisplayNameAndKeepsImmutableSpeakerId() {
        Speaker speaker = speaker(MEETING_ID);
        when(speakerRepository.findById(SPEAKER_ID)).thenReturn(Optional.of(speaker));
        RenameSpeakerRequest request = new RenameSpeakerRequest();
        request.setSpeakerId(SPEAKER_ID);
        request.setNewName("Minh");

        service.renameSpeaker(MEETING_ID, request);

        assertEquals(SPEAKER_ID, speaker.getId());
        assertEquals("Minh", speaker.getRealName());
        verify(speakerRepository).save(speaker);
        verify(speakerSegmentRepository, never()).saveAll(any());
        verifyNoInteractions(speakerSegmentRepository);
    }

    @Test
    void renameCannotMutateSpeakerFromAnotherMeeting() {
        when(speakerRepository.findById(SPEAKER_ID)).thenReturn(Optional.of(speaker(UUID.randomUUID())));
        RenameSpeakerRequest request = new RenameSpeakerRequest();
        request.setSpeakerId(SPEAKER_ID);
        request.setNewName("Minh");

        assertThrows(BusinessException.class, () -> service.renameSpeaker(MEETING_ID, request));
        verify(speakerRepository, never()).save(any());
        verifyNoInteractions(speakerSegmentRepository);
    }

    private Speaker speaker(UUID meetingId) {
        Speaker speaker = new Speaker();
        speaker.setId(SPEAKER_ID);
        speaker.setMeetingId(meetingId);
        speaker.setAiLabel("SPEAKER 1");
        return speaker;
    }
}
