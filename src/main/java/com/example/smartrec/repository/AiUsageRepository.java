package com.example.smartrec.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.AiUsage;

public interface AiUsageRepository extends JpaRepository<AiUsage, UUID> {

    Optional<AiUsage> findFirstByJobIdOrderByCreatedAtAsc(UUID jobId);

    @Modifying
    @Transactional
    @Query(value = """
            INSERT INTO ai_usage (
                request_id, job_id, meeting_id, model_name, model_version, provider,
                task_type, input_tokens, output_tokens, total_tokens, token_source,
                processing_time_ms, status, fallback_used, estimated_cost, error_code, created_at
            ) VALUES (
                :requestId, :jobId, :meetingId, :modelName, :modelVersion, :provider,
                :taskType, :inputTokens, :outputTokens, :totalTokens, :tokenSource,
                :processingTimeMs, :status, :fallbackUsed, :estimatedCost, :errorCode, NOW()
            ) ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING
            """, nativeQuery = true)
    int insertIfNew(
            @Param("requestId") UUID requestId,
            @Param("jobId") UUID jobId,
            @Param("meetingId") UUID meetingId,
            @Param("modelName") String modelName,
            @Param("modelVersion") String modelVersion,
            @Param("provider") String provider,
            @Param("taskType") String taskType,
            @Param("inputTokens") Long inputTokens,
            @Param("outputTokens") Long outputTokens,
            @Param("totalTokens") Long totalTokens,
            @Param("tokenSource") String tokenSource,
            @Param("processingTimeMs") Long processingTimeMs,
            @Param("status") String status,
            @Param("fallbackUsed") boolean fallbackUsed,
            @Param("estimatedCost") Double estimatedCost,
            @Param("errorCode") String errorCode);
}
