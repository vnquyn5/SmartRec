package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.impl.MeetingProcessingServiceImpl;

@ExtendWith(MockitoExtension.class)
class MeetingProcessingStartTest {
    @Mock private MeetingRepository meetingRepository;
    @Mock private MediaFileRepository mediaFileRepository;
    @Mock private UserRepository userRepository;
    @Mock private MinioService minioService;
    @Mock private JobService jobService;
    @InjectMocks private MeetingProcessingServiceImpl processingService;

    private UUID userId;
    private Meeting meeting;
    private MediaFile mediaFile;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken("alice@example.com", null, List.of(() -> "USER")));
        meeting = Meeting.builder().id(UUID.randomUUID()).workspace_id(userId)
                .media_file_id(UUID.randomUUID()).title("recording.mp3").status(MeetingStatus.UNPROCESSED).build();
        mediaFile = MediaFile.builder().id(meeting.getMedia_file_id()).object_key("media/recording.mp3")
                .status("UPLOADED").build();
        when(meetingRepository.findByIdForUpdate(meeting.getId())).thenReturn(Optional.of(meeting));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void startsAnUnprocessedMeetingAfterVerifyingStoredMedia() {
        stubCurrentUser();
        JobResponse response = JobResponse.builder().id(UUID.randomUUID()).status(JobStatus.QUEUED).build();
        when(mediaFileRepository.findById(mediaFile.getId())).thenReturn(Optional.of(mediaFile));
        when(minioService.objectExists(mediaFile.getObject_key())).thenReturn(true);
        when(jobService.createJob(any())).thenReturn(response);

        assertSame(response, processingService.processMeeting(meeting.getId()));
        verify(jobService).createJob(any());
        verify(minioService).objectExists("media/recording.mp3");
    }

    @Test
    void returnsExistingActiveJobWithoutCreatingAnother() {
        stubCurrentUser();
        UUID activeJobId = UUID.randomUUID();
        meeting.setActive_job_id(activeJobId);
        meeting.setStatus(MeetingStatus.PROCESSING);
        JobResponse activeJob = JobResponse.builder().id(activeJobId).status(JobStatus.PROCESSING).build();
        when(jobService.getJob(activeJobId)).thenReturn(activeJob);

        assertSame(activeJob, processingService.processMeeting(meeting.getId()));
        verify(jobService, never()).createJob(any());
        verify(mediaFileRepository, never()).findById(any());
    }

    @Test
    void refusesToStartBeforeMergedObjectExists() {
        stubCurrentUser();
        when(mediaFileRepository.findById(mediaFile.getId())).thenReturn(Optional.of(mediaFile));
        when(minioService.objectExists(mediaFile.getObject_key())).thenReturn(false);

        org.junit.jupiter.api.Assertions.assertThrows(
                com.example.smartrec.exception.BusinessException.class,
                () -> processingService.processMeeting(meeting.getId()));
        verify(jobService, never()).createJob(any());
    }

    private void stubCurrentUser() {
        when(userRepository.findByEmail("alice@example.com")).thenReturn(Optional.of(User.builder()
                .id(userId).email("alice@example.com").build()));
    }
}
