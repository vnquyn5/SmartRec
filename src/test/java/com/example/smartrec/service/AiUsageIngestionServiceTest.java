package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import com.example.smartrec.entity.Job;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AiUsageRequest;
import com.example.smartrec.repository.AiUsageRepository;
import com.example.smartrec.repository.JobRepository;

@ExtendWith(MockitoExtension.class)
class AiUsageIngestionServiceTest {
    @Mock private AiUsageRepository usageRepository;
    @Mock private JobRepository jobRepository;

    private AiUsageIngestionService service;
    private UUID jobId;
    private UUID meetingId;
    private AiUsageRequest request;

    @BeforeEach
    void setUp() {
        service = new AiUsageIngestionService(usageRepository, jobRepository);
        jobId = UUID.randomUUID();
        meetingId = UUID.randomUUID();
        request = new AiUsageRequest();
        request.setRequestId(UUID.randomUUID());
        request.setJobId(jobId);
        request.setModelName("test-model");
        request.setProvider("LOCAL");
        request.setTaskType("summary");
        request.setTokenSource("unavailable");
        request.setProcessingTimeMs(23L);
        request.setStatus("success");
    }

    @Test
    void storesUsageLinkedToMeetingAndKeepsMissingCountsNull() {
        when(jobRepository.findById(jobId)).thenReturn(java.util.Optional.of(
                Job.builder().id(jobId).meetingId(meetingId).build()));
        when(usageRepository.insertIfNew(any(), eq(jobId), eq(meetingId), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any(), any(Boolean.class), any(), any())).thenReturn(1);

        assertTrue(service.record(request));
        verify(usageRepository).insertIfNew(request.getRequestId(), jobId, meetingId, "test-model", null,
                "LOCAL", "summary", null, null, null, "unavailable", 23L, "success", false, null, null);
    }

    @Test
    void databaseConflictIsReportedAsDuplicateWithoutOverwriting() {
        when(jobRepository.findById(jobId)).thenReturn(java.util.Optional.of(
                Job.builder().id(jobId).meetingId(meetingId).build()));
        when(usageRepository.insertIfNew(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(Boolean.class), any(), any())).thenReturn(0);
        assertFalse(service.record(request));
    }

    @Test
    void rejectsMeetingThatDoesNotBelongToJob() {
        request.setMeetingId(UUID.randomUUID());
        when(jobRepository.findById(jobId)).thenReturn(java.util.Optional.of(
                Job.builder().id(jobId).meetingId(meetingId).build()));
        BusinessException error = assertThrows(BusinessException.class, () -> service.record(request));
        assertEquals(org.springframework.http.HttpStatus.BAD_REQUEST, error.getStatus());
    }
}
