package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.example.smartrec.entity.*;
import com.example.smartrec.enums.*;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.MeetingSlideMetadataRequest;
import com.example.smartrec.repository.*;
import com.example.smartrec.service.impl.MeetingSlideServiceImpl;

class MeetingSlideServiceImplTest {
    MeetingSlideRepository slides = mock(MeetingSlideRepository.class);
    JobRepository jobs = mock(JobRepository.class);
    MeetingRepository meetings = mock(MeetingRepository.class);
    MeetingSlideServiceImpl service = new MeetingSlideServiceImpl(slides, jobs, meetings);
    UUID meetingId = UUID.randomUUID(), jobId = UUID.randomUUID(), execution = UUID.randomUUID();
    Job job;
    Meeting meeting;
    MeetingSlideMetadataRequest request;

    @BeforeEach void setup() throws Exception {
        job = Job.builder().id(jobId).meetingId(meetingId).executionId(execution)
            .status(JobStatus.PROCESSING).currentStage(PipelineStage.OUTPUT)
            .leaseExpiresAt(Instant.now().plusSeconds(120)).build();
        meeting = new Meeting();
        meeting.setActive_job_id(jobId);
        when(jobs.findByIdForUpdate(jobId)).thenReturn(Optional.of(job));
        when(meetings.findById(meetingId)).thenReturn(Optional.of(meeting));
        request = new ObjectMapper().readValue("""
            {"slideId":"%s","meetingId":"%s","jobId":"%s","timestampMs":100,
             "objectKey":"meetings/%s/jobs/%s/ocr/slide.jpg","ocrText":"Nội dung"}
            """.formatted(UUID.randomUUID(), meetingId, jobId, meetingId, jobId), MeetingSlideMetadataRequest.class);
        when(slides.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    }
    @Test void stableIdentityOnRetry() {
        var first = service.saveMetaData(request, execution);
        var captured = org.mockito.ArgumentCaptor.forClass(MeetingSlide.class);
        verify(slides).save(captured.capture());
        assertEquals(request.getSlideId(), captured.getValue().getSlideId());
        when(slides.findById(request.getSlideId())).thenReturn(Optional.of(captured.getValue()));
        service.saveMetaData(request, execution);
        verify(slides, times(2)).save(captured.getValue());
    }
    @Test void rejectsForeignJob() {
        job.setMeetingId(UUID.randomUUID());
        assertThrows(BusinessException.class, () -> service.saveMetaData(request, execution));
        verifyNoInteractions(slides);
    }
    @Test void rejectsMissingMeeting() {
        when(meetings.findById(meetingId)).thenReturn(Optional.empty());
        assertThrows(BusinessException.class, () -> service.saveMetaData(request, execution));
        verifyNoInteractions(slides);
    }
    @Test void rejectsMissingJob() {
        when(jobs.findByIdForUpdate(jobId)).thenReturn(Optional.empty());
        assertThrows(BusinessException.class, () -> service.saveMetaData(request, execution));
        verifyNoInteractions(slides);
    }
    @Test void rejectsLostLeaseAndTerminalJob() {
        assertThrows(BusinessException.class, () -> service.saveMetaData(request, null));
        assertThrows(BusinessException.class, () -> service.saveMetaData(request, UUID.randomUUID()));
        job.setLeaseExpiresAt(Instant.now().minusSeconds(1));
        assertThrows(BusinessException.class, () -> service.saveMetaData(request, execution));
        job.setLeaseExpiresAt(Instant.now().plusSeconds(120));
        job.setStatus(JobStatus.COMPLETED);
        assertThrows(BusinessException.class, () -> service.saveMetaData(request, execution));
        verifyNoInteractions(slides);
    }
    @Test void rejectsInactiveJob() {
        meeting.setActive_job_id(UUID.randomUUID());
        assertThrows(BusinessException.class, () -> service.saveMetaData(request, execution));
        verifyNoInteractions(slides);
    }
    @Test void rejectsInvalidMetadata() {
        for (String key : new String[]{"other/job/slide.jpg", "meetings/"+meetingId+"/jobs/"+jobId+"/ocr/../slide.jpg", ""}) {
            org.springframework.test.util.ReflectionTestUtils.setField(request, "objectKey", key);
            assertThrows(BusinessException.class, () -> service.saveMetaData(request, execution));
        }
        verify(slides, never()).save(any());
    }
    @Test void rejectsIdentityCollision() {
        var existing = new MeetingSlide();
        existing.setMeetingId(UUID.randomUUID());
        when(slides.findById(request.getSlideId())).thenReturn(Optional.of(existing));
        assertThrows(BusinessException.class, () -> service.saveMetaData(request, execution));
        verify(slides, never()).save(any());
    }
}
