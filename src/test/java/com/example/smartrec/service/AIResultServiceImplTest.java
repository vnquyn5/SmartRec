package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.AiUsage;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.AiUsageRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.service.impl.AIResponseValidatorImpl;
import com.example.smartrec.service.impl.AIResultServiceImpl;
import com.fasterxml.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class AIResultServiceImplTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Mock private JobRepository jobRepository;
    @Mock private SummaryRepository summaryRepository;
    @Mock private ActionItemRepository actionItemRepository;
    @Mock private AiUsageRepository aiUsageRepository;

    private AIResultService service;
    private UUID jobId;
    private UUID meetingId;

    @BeforeEach
    void setUp() {
        service = new AIResultServiceImpl(jobRepository, summaryRepository, actionItemRepository,
                aiUsageRepository, new AIResponseValidatorImpl());
        jobId = UUID.randomUUID();
        meetingId = UUID.randomUUID();
        org.mockito.Mockito.lenient().when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(
                Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.PROCESSING).build()));
        org.mockito.Mockito.lenient().when(summaryRepository.findByProcessingJobId(jobId)).thenReturn(Optional.empty());
        org.mockito.Mockito.lenient().when(aiUsageRepository.findFirstByJobIdOrderByCreatedAtAsc(jobId))
                .thenReturn(Optional.empty());
    }

    @Test
    void savesSuccessfulLocalSummaryAndUsage() throws Exception {
        AIResponse response = summaryResponse("local", "local-model", false);
        response.setInputTokens(120L);
        response.setOutputTokens(40L);
        response.setLatencyMs(850L);

        service.saveAIResult(response);

        verify(summaryRepository).save(any(Summary.class));
        verify(aiUsageRepository).save(org.mockito.ArgumentMatchers.argThat(usage ->
                usage.getModelName().equals("local-model")
                        && usage.getTotalTokens() == 160L
                        && usage.getProcessingTime() == 850L
                        && !usage.getFallbackUsed()));
    }

    @Test
    void savesSuccessfulGeminiFallbackSummaryAndUsage() throws Exception {
        AIResponse response = summaryResponse("gemini", "gemini-2.5-flash", true);
        response.setFallbackReason("local model unavailable");
        response.setRetryCount(2);
        response.setLatencyMs(1250L);

        service.saveAIResult(response);

        verify(summaryRepository).save(any(Summary.class));
        verify(aiUsageRepository).save(org.mockito.ArgumentMatchers.argThat(AiUsage::getFallbackUsed));
    }

    @Test
    void rejectsNullResponse() {
        BusinessException exception = assertThrows(BusinessException.class, () -> service.saveAIResult(null));
        assertEquals("AI_RESPONSE_NULL", exception.getCode());
    }

    @Test
    void rejectsResponseMeetingIdMismatch() throws Exception {
        AIResponse response = summaryResponse("local", "local-model", false);
        response.setMeetingId(UUID.randomUUID());

        BusinessException exception = assertThrows(BusinessException.class, () -> service.saveAIResult(response));

        assertEquals("AI_MEETING_ID_MISMATCH", exception.getCode());
        verify(summaryRepository, never()).save(any());
    }

    @Test
    void rejectsUnsupportedTaskType() throws Exception {
        AIResponse response = summaryResponse("local", "local-model", false);
        response.setTaskType("TRANSCRIBE");

        BusinessException exception = assertThrows(BusinessException.class, () -> service.saveAIResult(response));

        assertEquals("UNSUPPORTED_AI_TASK_TYPE", exception.getCode());
    }

    @Test
    void rejectsFailedAIResponse() throws Exception {
        AIResponse response = summaryResponse("gemini", "gemini-2.5-flash", true);
        response.setStatus("FAILED");

        BusinessException exception = assertThrows(BusinessException.class, () -> service.saveAIResult(response));

        assertEquals("AI_PROCESSING_FAILED", exception.getCode());
        assertEquals(HttpStatus.BAD_GATEWAY, exception.getStatus());
    }

    @Test
    void acceptsMissingOptionalMetadata() throws Exception {
        AIResponse response = summaryResponse("local", "local-model", false);
        response.setInputTokens(null);
        response.setOutputTokens(null);
        response.setLatencyMs(null);
        response.setRetryCount(null);
        response.setEstimatedCost(null);

        service.saveAIResult(response);

        verify(summaryRepository).save(any(Summary.class));
        verify(aiUsageRepository).save(any(AiUsage.class));
    }

    @Test
    void doesNotSaveDuplicateForCompletedJob() throws Exception {
        when(jobRepository.findByIdForUpdate(jobId)).thenReturn(Optional.of(
                Job.builder().id(jobId).meetingId(meetingId).status(JobStatus.COMPLETED).build()));

        service.saveAIResult(summaryResponse("gemini", "gemini-2.5-flash", true));

        verify(summaryRepository, never()).save(any());
        verify(aiUsageRepository, never()).save(any());
    }

    @Test
    void persistsTaskMatrixItems() throws Exception {
        AIResponse response = summaryResponse("local", "local-model", false);
        response.setTaskType("TASK_MATRIX");
        response.setResult(OBJECT_MAPPER.readTree("""
                {"actionItems":[{"taskName":"Prepare report","assigneeName":"An","status":"OPEN"}]}
                """));

        service.saveAIResult(response);

        verify(actionItemRepository).deleteByProcessingJobId(jobId);
        verify(actionItemRepository).saveAll(any());
    }

    private AIResponse summaryResponse(String provider, String model, boolean fallbackUsed) throws Exception {
        return AIResponse.builder()
                .jobId(jobId)
                .meetingId(meetingId)
                .taskType("SUMMARY")
                .provider(provider)
                .model(model)
                .fallbackUsed(fallbackUsed)
                .status("SUCCESS")
                .result(OBJECT_MAPPER.readTree("""
                        {"executiveSummary":"Meeting summary","highlights":[]}
                        """))
                .build();
    }
}
