package com.example.smartrec.service;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.repository.AiUsageRepository;
import com.example.smartrec.repository.AiUsageRepository.JobUsageTotals;

import lombok.RequiredArgsConstructor;

/**
 * Cung cấp số liệu {@code ai_usage} cho một cặp meeting/job.
 * Service kiểm tra quyền đọc, dùng các tổng và bộ đếm từ PostgreSQL để xác định
 * chỉ số nào có đủ dữ liệu, rồi trả kết quả cho caller nội bộ.
 */
@Service
@RequiredArgsConstructor
public class AIUsageAnalyticsService {
    private final JobProgressAccessService jobProgressAccessService;
    private final AiUsageRepository aiUsageRepository;

    /**
     * Trạng thái của từng chỉ số token hoặc thời gian.
     * <ul>
     *   <li>{@code AVAILABLE} — Tổng đã xác định, có thể bằng 0.</li>
     *   <li>{@code NO_DATA} — Chưa có bản ghi usage thuộc cặp meeting/job.</li>
     *   <li>{@code NO_SUCCESSFUL_USAGE} — Các lượt usage được giữ đều thất bại.</li>
     *   <li>{@code INCOMPLETE_DATA} — Ít nhất một lượt thành công thiếu số đo của chỉ số này.</li>
     *   <li>{@code INVALID_DATA} — Có trạng thái usage ngoài hợp đồng hoặc số đo âm.</li>
     *   <li>{@code UNVERIFIABLE_REQUESTS} — Có nhiều lượt thành công và ít nhất một lượt thiếu ID để đối soát retry.</li>
     * </ul>
     */
    public enum MetricStatus {
        AVAILABLE, NO_DATA, NO_SUCCESSFUL_USAGE, INCOMPLETE_DATA, INVALID_DATA, UNVERIFIABLE_REQUESTS
    }

    /** Điều kiện tính chi phí tiết kiệm, độc lập với trạng thái token và thời gian. */
    public enum CostSavingsStatus {
        INSUFFICIENT_PRICING_DATA
    }

    /** Giá trị chỉ có khi trạng thái là {@link MetricStatus#AVAILABLE}. */
    public record Metric(MetricStatus status, BigInteger value) {}

    /** Giữ {@code amount} là {@code null} cho đến khi xác nhận đủ điều kiện tính. */
    public record CostSavings(CostSavingsStatus status, BigDecimal amount) {}

    /** Kết quả nội bộ chứa trạng thái và giá trị của từng chỉ số cho job đã yêu cầu. */
    public record JobUsageAnalytics(Metric totalTokens, Metric cumulativeProcessingTimeMs, CostSavings costSavings) {}

    /**
     * Tổng hợp các lượt AI thành công sau khi xác thực caller và kiểm tra quyền sở hữu cuộc họp.
     * Các lượt suy luận chạy song song vẫn đóng góp toàn bộ {@code processing_time_ms} của từng lượt.
     * Vì vậy thời gian cộng dồn có thể vượt thời gian thực tế từ lúc bắt đầu đến lúc kết thúc job.
     *
     * @param meetingId cuộc họp được yêu cầu, bắt buộc
     * @param jobId job phải thuộc cuộc họp được yêu cầu, bắt buộc
     * @return tổng token, thời gian suy luận cộng dồn và trạng thái chi phí tiết kiệm
     * @throws BusinessException nếu thiếu ID, thiếu quyền hoặc cặp meeting/job không tồn tại
     * @throws org.springframework.dao.DataAccessException nếu truy vấn cơ sở dữ liệu thất bại
     */
    @Transactional(readOnly = true)
    public JobUsageAnalytics aggregateForJob(UUID meetingId, UUID jobId) {
        if (meetingId == null || jobId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "AI_USAGE_SCOPE_REQUIRED", "Cần cung cấp Meeting và Job");
        }
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Yêu cầu đăng nhập");
        }
        // Quyền đọc qua link chia sẻ thuộc phạm vi Guest. Analytics yêu cầu tài khoản chủ cuộc họp.
        if (authentication.getAuthorities().stream().anyMatch(role -> "ROLE_GUEST".equals(role.getAuthority()))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, "MEETING_ACCESS_DENIED",
                    "Bạn không có quyền truy cập cuộc họp này");
        }
        // Dùng quyền đọc job hiện có để xác minh chủ cuộc họp và cặp meeting/job trước khi đọc usage.
        jobProgressAccessService.assertCanReadJob(meetingId, jobId, authentication.getName());

        JobUsageTotals totals = aiUsageRepository.aggregateForJob(meetingId, jobId);
        // Khoản tiết kiệm cần baseline, nguồn đơn giá, tiền tệ và công thức đã xác nhận.
        // estimated_cost chỉ phản ánh chi phí ước tính của một lượt usage.
        CostSavings costSavings = new CostSavings(CostSavingsStatus.INSUFFICIENT_PRICING_DATA, null);

        // Tình trạng của tập lượt usage ảnh hưởng đến cả token và thời gian.
        MetricStatus requestStatus = requestStatus(totals);
        if (requestStatus != MetricStatus.AVAILABLE) {
            Metric unavailable = new Metric(requestStatus, null);
            return new JobUsageAnalytics(unavailable, unavailable, costSavings);
        }

        // Sau khi xác định được tập lượt hợp lệ, kiểm tra đủ số đo cho từng chỉ số độc lập.
        long expectedCount = totals.getSuccessfulRequestCount();
        return new JobUsageAnalytics(
                measuredTotal(expectedCount, totals.getMeasuredTokenCount(), totals.getInvalidTokenCount(),
                        totals.getTotalTokens()),
                measuredTotal(expectedCount, totals.getMeasuredTimeCount(), totals.getInvalidTimeCount(),
                        totals.getCumulativeProcessingTimeMs()),
                costSavings);
    }

    private MetricStatus requestStatus(JobUsageTotals totals) {
        if (totals.getRequestCount() == 0) {
            return MetricStatus.NO_DATA;
        }
        // Trạng thái lạ khiến tập các lượt thành công chưa xác định được đầy đủ.
        if (totals.getInvalidStatusCount() > 0) {
            return MetricStatus.INVALID_DATA;
        }
        long successCount = totals.getSuccessfulRequestCount();
        if (successCount == 0) {
            return MetricStatus.NO_SUCCESSFUL_USAGE;
        }
        // Nếu có nhiều lượt thành công, một lượt cũ thiếu request_id có thể trùng với lượt khác trong job.
        if (successCount > 1 && totals.getUnidentifiedSuccessCount() > 0) {
            return MetricStatus.UNVERIFIABLE_REQUESTS;
        }
        return MetricStatus.AVAILABLE;
    }

    private Metric measuredTotal(long expectedCount, long measuredCount, long invalidCount, BigDecimal total) {
        // Ưu tiên báo dữ liệu lỗi nếu cùng một chỉ số có cả số đo âm và số đo bị thiếu.
        if (invalidCount > 0) {
            return new Metric(MetricStatus.INVALID_DATA, null);
        }
        // SUM của PostgreSQL bỏ qua null. Đối chiếu COUNT để tránh trả tổng của một phần số đo.
        if (measuredCount < expectedCount) {
            return new Metric(MetricStatus.INCOMPLETE_DATA, null);
        }
        // PostgreSQL trả numeric cho tổng. BigInteger giữ nguyên số đếm kể cả khi vượt phạm vi long.
        return new Metric(MetricStatus.AVAILABLE, total.toBigIntegerExact());
    }
}
