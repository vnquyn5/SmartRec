package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.example.smartrec.entity.ContextPayload;
import com.example.smartrec.entity.MeetingSlide;
import com.example.smartrec.entity.Transcript;
import com.example.smartrec.model.dto.ContextPayloadReponse;
import com.example.smartrec.repository.ContextPayloadRepository;
import com.example.smartrec.repository.MeetingSlideRepository;
import com.example.smartrec.repository.TranscriptRepository;
import com.example.smartrec.service.impl.ContextPayloadServiceImpl;

@ExtendWith(MockitoExtension.class)
class ContextPayloadServiceImplTest {

    @Mock
    private ContextPayloadRepository contextPayloadRepository;

    @Mock
    private MeetingSlideRepository meetingSlideRepository;

    @Mock
    private TranscriptRepository transcriptRepository;

    @InjectMocks
    private ContextPayloadServiceImpl service;

    private Transcript transcript(
            UUID meetingId, long start, long end, String text) {

        Transcript item = new Transcript();
        item.setMeetingId(meetingId);
        item.setSpeakerId(UUID.randomUUID());
        item.setStartTimeMs(start);
        item.setEndTimeMs(end);
        item.setTextContent(text);
        return item;
    }

    @Test
    void audioOnly_shouldCreateContextWithoutOCR() {
        UUID meetingId = UUID.randomUUID();

        Transcript segment = transcript(
                meetingId, 1000L, 2500L, "Hoàn thành API upload.");

        when(transcriptRepository
                .findByMeetingIdOrderByStartTimeMsAsc(meetingId))
                .thenReturn(List.of(segment));

        when(meetingSlideRepository
                .findByMeetingIdOrderByTimestampMsAsc(meetingId))
                .thenReturn(List.of());

        when(contextPayloadRepository.findByMeetingId(meetingId))
                .thenReturn(Optional.empty());

        ContextPayloadReponse response =
                service.createContext(meetingId);

        assertEquals(meetingId, response.getMeetingId());
        assertEquals(1, response.getContextItems().size());

        var item = response.getContextItems().get(0);

        assertEquals("Hoàn thành API upload.", item.getTranscript());
        assertEquals(1000L, item.getStart());
        assertEquals(2500L, item.getEnd());
        assertEquals(segment.getSpeakerId().toString(), item.getSpeaker());
        assertNull(item.getSlideText());

        ArgumentCaptor<ContextPayload> captor =
                ArgumentCaptor.forClass(ContextPayload.class);

        verify(contextPayloadRepository).save(captor.capture());

        assertEquals(meetingId, captor.getValue().getMeetingId());
        assertEquals(1,
                ((List<?>) captor.getValue().getPayload()
                        .get("context_items")).size());
    }

    @Test
    void jobContextAllowsUnknownSpeakerWithoutCreatingAnIdentity() {
        UUID meetingId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        Transcript segment = transcript(meetingId, 1000L, 2500L, "Speaker identity is unknown.");
        segment.setId(UUID.randomUUID());
        segment.setProcessingJobId(jobId);
        segment.setSpeakerId(null);
        when(transcriptRepository.findByProcessingJobIdOrderByStartTimeMsAsc(jobId))
                .thenReturn(List.of(segment));
        when(meetingSlideRepository.findByMeetingIdAndJobIdOrderByTimestampMsAsc(meetingId, jobId))
                .thenReturn(List.of());

        var context = service.createJobContext(meetingId, jobId, true);

        assertEquals(meetingId, context.meetingId());
        assertEquals(jobId, context.jobId());
        assertNull(context.evidence().get(0).speakerId());
        assertEquals(segment.getId(), context.evidence().get(0).sourceId());
    }

    @Test
    void videoWithOCR_shouldMergeContextInTimelineOrder() {
        UUID meetingId = UUID.randomUUID();

        Transcript first = transcript(
                meetingId, 1000L, 2000L, "Bắt đầu cuộc họp.");

        Transcript second = transcript(
                meetingId, 6000L, 7500L, "Thống nhất kế hoạch.");

        MeetingSlide slide = new MeetingSlide();
        slide.setMeetingId(meetingId);
        slide.setTimestampMs(3000L);
        slide.setOcrText("Kế hoạch Sprint 3");

        when(transcriptRepository
                .findByMeetingIdOrderByStartTimeMsAsc(meetingId))
                .thenReturn(List.of(first, second));

        when(meetingSlideRepository
                .findByMeetingIdOrderByTimestampMsAsc(meetingId))
                .thenReturn(List.of(slide));

        when(contextPayloadRepository.findByMeetingId(meetingId))
                .thenReturn(Optional.empty());

        ContextPayloadReponse response =
                service.createContext(meetingId);

        var items = response.getContextItems();

        assertEquals(3, items.size());

        assertEquals("Bắt đầu cuộc họp.",
                items.get(0).getTranscript());

        assertEquals("Kế hoạch Sprint 3",
                items.get(1).getSlideText());
        assertEquals(3000L,
                items.get(1).getSlideTimestamp());

        assertEquals("Thống nhất kế hoạch.",
                items.get(2).getTranscript());

        verify(contextPayloadRepository).save(any(ContextPayload.class));
    }

    @Test
    void jobContextKeepsPersistentReferencesWithoutOverwritingMeetingContext() {
        UUID meeting = UUID.randomUUID(), job = UUID.randomUUID();
        var item = transcript(meeting, 0, 1000, "Job evidence");
        item.setId(UUID.randomUUID());
        item.setProcessingJobId(job);
        when(transcriptRepository.findByProcessingJobIdOrderByStartTimeMsAsc(job)).thenReturn(List.of(item));
        var result = service.createJobContext(meeting, job, false);
        assertEquals(job, result.jobId());
        assertEquals(item.getId(), result.evidence().get(0).sourceId());
        assertEquals(item.getSpeakerId(), result.evidence().get(0).speakerId());
        assertEquals(1000L, result.evidence().get(0).endTimeMs());
        verifyNoInteractions(meetingSlideRepository, contextPayloadRepository);
        item.setProcessingJobId(UUID.randomUUID());
        assertThrows(com.example.smartrec.exception.BusinessException.class,
                () -> service.createJobContext(meeting, job, false));
    }

    @Test
    void jobContextRequiresTranscriptAndAcceptsMissingOptionalOcr() {
        UUID meeting = UUID.randomUUID(), job = UUID.randomUUID();
        when(transcriptRepository.findByProcessingJobIdOrderByStartTimeMsAsc(job)).thenReturn(List.of());
        assertThrows(com.example.smartrec.exception.BusinessException.class,
                () -> service.createJobContext(meeting, job, true));
        verifyNoInteractions(meetingSlideRepository);
        var item = transcript(meeting, 0, 1000, "Required transcript");
        item.setId(UUID.randomUUID()); item.setProcessingJobId(job);
        when(transcriptRepository.findByProcessingJobIdOrderByStartTimeMsAsc(job)).thenReturn(List.of(item));
        when(meetingSlideRepository.findByMeetingIdAndJobIdOrderByTimestampMsAsc(meeting, job)).thenReturn(List.of());
        assertEquals(1, service.createJobContext(meeting, job, true).evidence().size());
        verifyNoInteractions(contextPayloadRepository);
    }
}
