package com.example.smartrec.service;

import static com.example.smartrec.service.AIUsageAnalyticsService.MetricStatus.AVAILABLE;
import static com.example.smartrec.service.AIUsageAnalyticsService.MetricStatus.INCOMPLETE_DATA;
import static com.example.smartrec.service.AIUsageAnalyticsService.MetricStatus.INVALID_DATA;
import static com.example.smartrec.service.AIUsageAnalyticsService.MetricStatus.NO_DATA;
import static com.example.smartrec.service.AIUsageAnalyticsService.MetricStatus.NO_SUCCESSFUL_USAGE;
import static com.example.smartrec.service.AIUsageAnalyticsService.MetricStatus.UNVERIFIABLE_REQUESTS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.AIUsageAnalyticsService.CostSavingsStatus;
import com.example.smartrec.service.AIUsageAnalyticsService.JobUsageAnalytics;
import com.example.smartrec.service.AIUsageAnalyticsService.Metric;
import com.example.smartrec.service.AIUsageAnalyticsService.MetricStatus;
import com.example.smartrec.service.impl.JobProgressAccessServiceImpl;

/**
 * Kiểm tra SQL aggregate và quyền đọc job bằng service, repository và PostgreSQL thật.
 * Bật bằng {@code -Dsmartrec.integration=true} với datasource kiểm thử đã nạp schema.
 */
@DataJpaTest(showSql = false, properties = {
        "spring.sql.init.mode=never",
        "spring.jpa.hibernate.ddl-auto=none",
        "logging.level.org.hibernate.SQL=OFF",
        "logging.level.org.hibernate.orm.jdbc.bind=OFF"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({AIUsageAnalyticsService.class, JobProgressAccessServiceImpl.class})
@EnabledIfSystemProperty(named = "smartrec.integration", matches = "true")
class AIUsageAnalyticsServiceIntegrationTest {
    private static final String OWNER = "owner@example.test";
    private static final String OTHER_USER = "other@example.test";
    private static final OffsetDateTime RECORDED_AT = OffsetDateTime.parse("2026-01-01T00:00:00Z");

    @Autowired private AIUsageAnalyticsService service;
    @Autowired private JdbcTemplate jdbc;

    private UUID ownerId;
    private UUID meetingId;
    private UUID jobId;

    @BeforeEach
    void prepareOwnedJob() {
        // Dùng bảng tạm trong transaction để cô lập fixture và tạo được bản ghi request_id trùng.
        jdbc.execute("CREATE TEMP TABLE users (LIKE public.users) ON COMMIT DROP");
        jdbc.execute("CREATE TEMP TABLE meetings (LIKE public.meetings) ON COMMIT DROP");
        jdbc.execute("CREATE TEMP TABLE processing_jobs (LIKE public.processing_jobs) ON COMMIT DROP");
        jdbc.execute("CREATE TEMP TABLE ai_usage (LIKE public.ai_usage) ON COMMIT DROP");

        ownerId = user(OWNER);
        user(OTHER_USER);
        meetingId = meeting(ownerId);
        jobId = job(meetingId);
        signIn(OWNER, "ROLE_USER");
    }

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void sumsSuccessfulRequestsOnceAndExcludesRowsOutsideTheRequestedScope() {
        // Lượt đầu lấy total_tokens = 13. Lượt thứ hai cùng request_id mô phỏng bản ghi retry bị lưu trùng.
        UUID requestId = UUID.randomUUID();
        usage(jobId, meetingId, requestId, "success", 13L, 5L, 7L, 30L, 1);
        usage(jobId, meetingId, requestId, "success", 200L, null, null, 200L, 2);
        // Có chi phí ước tính nhưng vẫn thiếu baseline và quy tắc tính khoản tiết kiệm.
        jdbc.update("UPDATE ai_usage SET estimated_cost = ? WHERE request_id = ?", 0.01, requestId);
        usage(jobId, meetingId, UUID.randomUUID(), "success", null, 7L, 8L, 50L, 3);
        // Bản ghi đầu tiên của request này là failed, nên cả request bị loại khỏi tổng.
        UUID failedRequestId = UUID.randomUUID();
        usage(jobId, meetingId, failedRequestId, "failed", 300L, null, null, 300L, 4);
        usage(jobId, meetingId, failedRequestId, "success", 300L, null, null, 300L, 5);

        // Ba bản ghi ngoài phạm vi kiểm tra lọc job, lọc meeting và meeting_id ghi lệch với job.
        UUID otherMeetingId = meeting(ownerId);
        usage(job(meetingId), meetingId, UUID.randomUUID(), "success", 400L, null, null, 400L, 6);
        usage(job(otherMeetingId), otherMeetingId, UUID.randomUUID(), "success", 500L, null, null, 500L, 7);
        usage(jobId, otherMeetingId, UUID.randomUUID(), "success", 600L, null, null, 600L, 8);

        JobUsageAnalytics analytics = service.aggregateForJob(meetingId, jobId);

        // Hai lượt hợp lệ lần lượt đóng góp 13 và 15 token, 30 và 50 mili giây.
        assertEquals(new Metric(AVAILABLE, BigInteger.valueOf(28)), analytics.totalTokens());
        assertEquals(new Metric(AVAILABLE, BigInteger.valueOf(80)), analytics.cumulativeProcessingTimeMs());
        assertEquals(CostSavingsStatus.INSUFFICIENT_PRICING_DATA, analytics.costSavings().status());
        assertNull(analytics.costSavings().amount());
    }

    @Test
    void distinguishesNoRowsFromFailedUsageAndUnknownStatus() {
        assertUnavailable(NO_DATA, service.aggregateForJob(meetingId, jobId));

        usage(jobId, meetingId, UUID.randomUUID(), "failed", null, null, null, 20L, 1);
        assertUnavailable(NO_SUCCESSFUL_USAGE, service.aggregateForJob(meetingId, jobId));

        usage(jobId, meetingId, UUID.randomUUID(), "unexpected", 1L, null, null, 10L, 2);
        assertUnavailable(INVALID_DATA, service.aggregateForJob(meetingId, jobId));
    }

    @Test
    void preservesObservedZeroAndWithholdsIncompleteOrNegativeTotals() {
        usage(jobId, meetingId, UUID.randomUUID(), "success", null, 3L, null, 0L, 1);
        JobUsageAnalytics analytics = service.aggregateForJob(meetingId, jobId);
        assertEquals(new Metric(INCOMPLETE_DATA, null), analytics.totalTokens());
        assertEquals(new Metric(AVAILABLE, BigInteger.ZERO), analytics.cumulativeProcessingTimeMs());

        usage(jobId, meetingId, UUID.randomUUID(), "success", null, -1L, null, null, 2);
        analytics = service.aggregateForJob(meetingId, jobId);
        assertEquals(new Metric(INVALID_DATA, null), analytics.totalTokens());
        assertEquals(new Metric(INCOMPLETE_DATA, null), analytics.cumulativeProcessingTimeMs());

        usage(jobId, meetingId, UUID.randomUUID(), "success", 1L, null, null, -1L, 3);
        assertUnavailable(INVALID_DATA, service.aggregateForJob(meetingId, jobId));
    }

    @Test
    void resolvesLegacyMeetingByJobAndWithholdsTotalsWhenLegacyRequestsMightOverlap() {
        usage(jobId, null, null, "success", 0L, null, null, 6L, 1);
        JobUsageAnalytics analytics = service.aggregateForJob(meetingId, jobId);
        assertEquals(new Metric(AVAILABLE, BigInteger.ZERO), analytics.totalTokens());
        assertEquals(new Metric(AVAILABLE, BigInteger.valueOf(6)), analytics.cumulativeProcessingTimeMs());

        usage(jobId, meetingId, UUID.randomUUID(), "success", 4L, null, null, 8L, 2);
        assertUnavailable(UNVERIFIABLE_REQUESTS, service.aggregateForJob(meetingId, jobId));
    }

    @Test
    void sumsTokenComponentsAndDurationsBeyondTheBigintRange() {
        usage(jobId, meetingId, UUID.randomUUID(), "success", null,
                Long.MAX_VALUE, Long.MAX_VALUE, Long.MAX_VALUE, 1);
        usage(jobId, meetingId, UUID.randomUUID(), "success", 1L, null, null, 1L, 2);

        JobUsageAnalytics analytics = service.aggregateForJob(meetingId, jobId);

        BigInteger max = BigInteger.valueOf(Long.MAX_VALUE);
        assertEquals(new Metric(AVAILABLE, max.multiply(BigInteger.TWO).add(BigInteger.ONE)), analytics.totalTokens());
        assertEquals(new Metric(AVAILABLE, max.add(BigInteger.ONE)), analytics.cumulativeProcessingTimeMs());
    }

    @Test
    void rejectsMismatchedJobOtherOwnerGuestsAndAnonymousCallers() {
        usage(jobId, meetingId, UUID.randomUUID(), "success", 42L, null, null, 1L, 1);
        assertDenied(HttpStatus.NOT_FOUND, meeting(ownerId), jobId);
        assertDenied(HttpStatus.BAD_REQUEST, null, jobId);

        signIn(OTHER_USER, "ROLE_USER");
        assertDenied(HttpStatus.FORBIDDEN, meetingId, jobId);

        signIn(OWNER, "ROLE_GUEST");
        assertDenied(HttpStatus.FORBIDDEN, meetingId, jobId);

        SecurityContextHolder.getContext().setAuthentication(new AnonymousAuthenticationToken(
                "test", OWNER, List.of(new SimpleGrantedAuthority("ROLE_ANONYMOUS"))));
        assertDenied(HttpStatus.UNAUTHORIZED, meetingId, jobId);
    }

    @Test
    void propagatesQueryFailure() {
        // Bỏ cột trên bảng tạm để tạo lỗi SQL thật và kiểm tra lỗi được truyền ra caller.
        jdbc.execute("ALTER TABLE pg_temp.ai_usage DROP COLUMN processing_time_ms");

        assertThrows(DataAccessException.class, () -> service.aggregateForJob(meetingId, jobId));
    }

    private UUID user(String email) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, email, full_name, token_version, auth_provider) VALUES (?, ?, ?, 0, 'LOCAL')",
                id, email, "Test User");
        return id;
    }

    private UUID meeting(UUID userId) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO meetings (id, workspace_id, media_file_id, title, status) VALUES (?, ?, ?, ?, 'UNPROCESSED')",
                id, userId, UUID.randomUUID(), "Test Meeting");
        return id;
    }

    private UUID job(UUID jobMeetingId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO processing_jobs (id, meeting_id, media_file_id, status, retry_count, event_sequence, created_at)
                VALUES (?, ?, ?, 'COMPLETED', 0, 0, CURRENT_TIMESTAMP)
                """, id, jobMeetingId, UUID.randomUUID());
        return id;
    }

    private void usage(UUID usageJobId, UUID usageMeetingId, UUID requestId, String status,
            Long totalTokens, Long inputTokens, Long outputTokens, Long processingTimeMs, int seconds) {
        jdbc.update("""
                INSERT INTO ai_usage (id, job_id, meeting_id, request_id, status, total_tokens, input_tokens,
                                      output_tokens, processing_time_ms, model_name, fallback_used, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test-model', false, ?)
                """, UUID.randomUUID(), usageJobId, usageMeetingId, requestId, status, totalTokens,
                inputTokens, outputTokens, processingTimeMs, RECORDED_AT.plusSeconds(seconds));
    }

    private void signIn(String email, String role) {
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                email, null, List.of(new SimpleGrantedAuthority(role))));
    }

    private void assertUnavailable(MetricStatus status, JobUsageAnalytics analytics) {
        assertEquals(new Metric(status, null), analytics.totalTokens());
        assertEquals(new Metric(status, null), analytics.cumulativeProcessingTimeMs());
    }

    private void assertDenied(HttpStatus status, UUID requestedMeetingId, UUID requestedJobId) {
        BusinessException error = assertThrows(BusinessException.class,
                () -> service.aggregateForJob(requestedMeetingId, requestedJobId));
        assertEquals(status, error.getStatus());
    }
}
