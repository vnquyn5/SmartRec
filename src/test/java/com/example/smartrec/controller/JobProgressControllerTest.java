package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.JobSnapshotDTO;
import com.example.smartrec.service.JobProgressService;
import com.example.smartrec.service.JobService;

class JobProgressControllerTest {
    private final JobProgressService progressService = mock(JobProgressService.class);
    private final JobService jobService = mock(JobService.class);
    private final JobProgressController controller =
            new JobProgressController(progressService, jobService);

    @Test
    void snapshotChecksCurrentUserMeetingAccessBeforeReturningProgress() {
        UUID jobId = UUID.randomUUID();
        JobSnapshotDTO snapshot = new JobSnapshotDTO();
        when(progressService.getSnapshot(jobId)).thenReturn(snapshot);

        assertSame(snapshot, controller.getSnapshot(jobId).getBody());

        verify(jobService).getJobForCurrentUser(jobId);
        verify(progressService).getSnapshot(jobId);
    }

    @Test
    void deniedMeetingAccessNeverReadsJobSnapshot() {
        UUID jobId = UUID.randomUUID();
        when(jobService.getJobForCurrentUser(jobId))
                .thenThrow(new BusinessException(org.springframework.http.HttpStatus.FORBIDDEN,
                        "MEETING_ACCESS_DENIED", "Meeting management access denied"));

        assertThrows(BusinessException.class, () -> controller.getSnapshot(jobId));

        verify(jobService).getJobForCurrentUser(jobId);
        verifyNoInteractions(progressService);
    }
}
