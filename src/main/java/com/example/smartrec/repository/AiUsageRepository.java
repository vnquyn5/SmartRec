package com.example.smartrec.repository;

import java.math.BigDecimal;
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

    /**
     * Projection cho một hàng kết quả SQL. Số lượt thành công là mốc để kiểm tra độ đầy đủ
     * của cả hai chỉ số. Các bộ đếm số đo chỉ tính trên lượt thành công, đếm cả giá trị 0.
     * Số đo âm được đếm riêng để service chặn việc trả tổng có dữ liệu lỗi.
     */
    interface JobUsageTotals {
        long getRequestCount();
        long getSuccessfulRequestCount();
        long getUnidentifiedSuccessCount();
        long getInvalidStatusCount();
        long getMeasuredTokenCount();
        long getInvalidTokenCount();
        BigDecimal getTotalTokens();
        long getMeasuredTimeCount();
        long getInvalidTimeCount();
        BigDecimal getCumulativeProcessingTimeMs();
    }

    /**
     * Tổng hợp usage sau khi caller đã kiểm tra quyền đọc cặp meeting/job.
     * <ol>
     *   <li>{@code ranked_usage} lấy meeting từ {@code processing_jobs}. Bản ghi cũ có
     *       {@code ai_usage.meeting_id} trống được xác định qua job. Bản ghi có meeting khác bị loại.
     *       Trong mỗi {@code request_id}, thứ tự {@code created_at, id} xác định bản ghi đầu tiên.</li>
     *   <li>{@code usage_metrics} giữ bản ghi đầu tiên theo quy tắc ghi của {@code insertIfNew}.
     *       Việc chọn bản ghi diễn ra trước khi lọc theo trạng thái để giữ kết quả đã ghi nhận khi retry.
     *       Các lượt thiếu {@code request_id} vẫn được giữ để service nhận diện nguy cơ trùng.</li>
     *   <li>Token ưu tiên {@code total_tokens}. Nếu trường này trống, cộng {@code input_tokens}
     *       và {@code output_tokens} khi cả hai hiện diện và không âm. Phép cộng dùng {@code numeric}
     *       để tránh tràn {@code bigint}. Số đo âm được đánh dấu là dữ liệu lỗi.</li>
     *   <li>Truy vấn cuối cộng token và {@code processing_time_ms} cho các lượt {@code success}.
     *       Các bộ đếm cho biết có bao nhiêu lượt thành công, thiếu ID, thiếu số đo hoặc có dữ liệu lỗi.
     *       Nếu không có hàng nào thuộc phạm vi, các bộ đếm bằng 0 và các tổng là {@code null}.</li>
     * </ol>
     */
    @Query(value = """
            WITH ranked_usage AS (
                SELECT u.request_id, u.status, u.total_tokens, u.input_tokens, u.output_tokens,
                       u.processing_time_ms,
                       ROW_NUMBER() OVER (PARTITION BY u.request_id ORDER BY u.created_at, u.id) AS request_rank
                FROM ai_usage u
                JOIN processing_jobs j ON j.id = u.job_id
                WHERE j.id = :jobId AND j.meeting_id = :meetingId
                  AND (u.meeting_id IS NULL OR u.meeting_id = j.meeting_id)
            ), usage_metrics AS (
                SELECT request_id, status, processing_time_ms,
                       COALESCE(CAST(total_tokens AS numeric),
                           CASE WHEN input_tokens >= 0 AND output_tokens >= 0
                                THEN CAST(input_tokens AS numeric) + output_tokens END) AS tokens,
                       total_tokens < 0 OR (total_tokens IS NULL AND (input_tokens < 0 OR output_tokens < 0))
                           AS invalid_tokens
                FROM ranked_usage
                WHERE request_id IS NULL OR request_rank = 1
            )
            SELECT COUNT(*) AS "requestCount",
                   COUNT(*) FILTER (WHERE status = 'success') AS "successfulRequestCount",
                   COUNT(*) FILTER (WHERE status = 'success' AND request_id IS NULL) AS "unidentifiedSuccessCount",
                   COUNT(*) FILTER (WHERE status IS NULL OR status NOT IN ('success', 'failed')) AS "invalidStatusCount",
                   COUNT(tokens) FILTER (WHERE status = 'success') AS "measuredTokenCount",
                   COUNT(*) FILTER (WHERE status = 'success' AND invalid_tokens) AS "invalidTokenCount",
                   SUM(tokens) FILTER (WHERE status = 'success') AS "totalTokens",
                   COUNT(processing_time_ms) FILTER (WHERE status = 'success') AS "measuredTimeCount",
                   COUNT(*) FILTER (WHERE status = 'success' AND processing_time_ms < 0) AS "invalidTimeCount",
                   SUM(processing_time_ms) FILTER (WHERE status = 'success') AS "cumulativeProcessingTimeMs"
            FROM usage_metrics
            """, nativeQuery = true)
    JobUsageTotals aggregateForJob(@Param("meetingId") UUID meetingId, @Param("jobId") UUID jobId);

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
