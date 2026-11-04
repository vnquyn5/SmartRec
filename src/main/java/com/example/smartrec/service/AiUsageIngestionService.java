package com.example.smartrec.service;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Job;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AiUsageRequest;
import com.example.smartrec.repository.AiUsageRepository;
import com.example.smartrec.repository.JobRepository;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class AiUsageIngestionService {
    private final AiUsageRepository aiUsageRepository;
    private final JobRepository jobRepository;

    @Transactional
    public boolean record(AiUsageRequest request) {
        Job job = jobRepository.findById(request.getJobId())
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND, "AI_JOB_NOT_FOUND", "AI job not found"));
        UUID meetingId = job.getMeetingId();
        if (request.getMeetingId() != null && !request.getMeetingId().equals(meetingId)) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST, "AI_USAGE_MEETING_MISMATCH", "Meeting does not belong to AI job");
        }

        Long totalTokens = request.getTotalTokens();
        if (totalTokens == null && request.getInputTokens() != null && request.getOutputTokens() != null) {
            totalTokens = request.getInputTokens() + request.getOutputTokens();
        }

        return aiUsageRepository.insertIfNew(
                request.getRequestId(), job.getId(), meetingId, request.getModelName(),
                request.getModelVersion(), request.getProvider(), request.getTaskType(),
                request.getInputTokens(), request.getOutputTokens(), totalTokens,
                request.getTokenSource(), request.getProcessingTimeMs(), request.getStatus(),
                request.isFallbackUsed(), request.getEstimatedCost(), request.getErrorCode()) == 1;
    }
}
