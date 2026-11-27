package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.MeetingAuditLog;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.ResourceNotFoundException;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingAuditLogRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.service.MeetingService;

import lombok.RequiredArgsConstructor;

/** Đọc và đối chiếu dữ liệu Review Save dùng chung cho PDF, CSV và Word. */
@Service
@RequiredArgsConstructor
public class ReviewedMeetingReportReader {
    private static final String REVIEW_SAVE_EVENT = "HUMAN_REVIEW_SAVE";
    private static final String SUMMARY_ENTITY = "SUMMARY";
    private static final String ACTION_ITEM_ENTITY = "ACTION_ITEM";
    private static final Set<String> ACTION_ITEM_FIELDS = Set.of("title", "assigneeName", "dueDate", "deadlineRaw");

    private final MeetingService meetingService;
    private final JobRepository jobRepository;
    private final MeetingAuditLogRepository auditLogRepository;
    private final SummaryRepository summaryRepository;
    private final ActionItemRepository actionItemRepository;

    // Đọc quyền, audit và dữ liệu báo cáo từ cùng một ảnh chụp dữ liệu khi Review Save chạy đồng thời.
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ReviewedMeetingReport read(UUID meetingId, String errorPrefix) {
        // MeetingService xác minh quyền của người dùng trong Security Context trước khi đọc dữ liệu review.
        MeetingResponseDTO meeting = meetingService.getMeeting(meetingId);

        // Audit Review Save xác định job cần xuất vì job hiện hành có thể chứa kết quả AI mới chưa review.
        MeetingAuditLog latestReviewChange = auditLogRepository
                .findFirstByMeetingIdAndEventTypeAndJobIdIsNotNullOrderByCreatedAtDesc(
                        meetingId, REVIEW_SAVE_EVENT)
                .orElseThrow(() -> reviewNotConfirmed(errorPrefix));
        UUID reviewedJobId = latestReviewChange.getJobId();
        Job reviewedJob = jobRepository.findById(reviewedJobId)
                .filter(job -> meetingId.equals(job.getMeetingId()))
                .orElseThrow(() -> conflict(errorPrefix, "JOB_SCOPE_MISMATCH",
                        "Dữ liệu review không thuộc đúng cuộc họp"));
        if (reviewedJob.getStatus() != JobStatus.COMPLETED) {
            throw conflict(errorPrefix, "JOB_NOT_COMPLETED", "Job đã review không ở trạng thái hoàn tất");
        }

        List<MeetingAuditLog> reviewChanges = auditLogRepository
                .findByMeetingIdAndJobIdAndEventTypeOrderByCreatedAtDesc(meetingId, reviewedJobId, REVIEW_SAVE_EVENT);
        Summary summary = summaryRepository.findByProcessingJobId(reviewedJobId)
                .filter(value -> meetingId.equals(value.getMeetingId())
                        && reviewedJobId.equals(value.getProcessingJobId()))
                .orElseThrow(() -> new ResourceNotFoundException(errorPrefix + "_SUMMARY_NOT_FOUND",
                        "Không tìm thấy Summary thuộc phiên bản đã review"));
        if (summary.getExecutiveSummary() == null || summary.getExecutiveSummary().isBlank()) {
            throw conflict(errorPrefix, "SUMMARY_EMPTY", "Summary đã review không có nội dung để export");
        }
        MeetingAuditLog summaryChange = reviewChanges.stream()
                .filter(change -> SUMMARY_ENTITY.equals(change.getEntityType())
                        && "executiveSummary".equals(change.getFieldName()))
                .findFirst().orElse(null);
        if (summaryChange != null && !Objects.equals(summary.getId(), summaryChange.getEntityId())) {
            throw reviewDataChanged(errorPrefix);
        }
        confirmField(summaryChange, summary.getExecutiveSummary(), errorPrefix);

        List<ActionItem> actionItems = actionItemRepository.findByProcessingJobId(reviewedJobId);
        if (actionItems.stream().anyMatch(item -> !meetingId.equals(item.getMeetingId())
                || !reviewedJobId.equals(item.getProcessingJobId()))) {
            throw conflict(errorPrefix, "DATA_SCOPE_MISMATCH",
                    "Có Action Item không thuộc cùng cuộc họp và phiên bản review");
        }
        // Review Save luôn yêu cầu Summary. Nếu chỉ công việc thay đổi, audit có thể chỉ ghi các trường của công việc.
        if (summaryChange == null && actionItems.isEmpty()) {
            throw reviewNotConfirmed(errorPrefix);
        }

        Map<UUID, Map<String, MeetingAuditLog>> itemChanges = latestActionItemChanges(reviewChanges);
        List<ReviewedActionItem> tasks = actionItems.stream()
                .sorted(Comparator.comparing(ActionItem::getId))
                .map(item -> reviewedActionItem(item, itemChanges.get(item.getId()), errorPrefix))
                .toList();
        return new ReviewedMeetingReport(meetingId, Objects.toString(meeting.getTitle(), ""), meeting.getCreatedAt(),
                summary.getExecutiveSummary(), tasks);
    }

    private static Map<UUID, Map<String, MeetingAuditLog>> latestActionItemChanges(List<MeetingAuditLog> changes) {
        // Audit được đọc từ mới đến cũ nên bản ghi đầu tiên của mỗi cặp công việc và trường là bản mới nhất.
        Map<UUID, Map<String, MeetingAuditLog>> byItem = new HashMap<>();
        for (MeetingAuditLog change : changes) {
            String field = change.getFieldName();
            if (ACTION_ITEM_ENTITY.equals(change.getEntityType()) && change.getEntityId() != null
                    && field != null && ACTION_ITEM_FIELDS.contains(field)) {
                byItem.computeIfAbsent(change.getEntityId(), id -> new HashMap<>()).putIfAbsent(field, change);
            }
        }
        return byItem;
    }

    private static ReviewedActionItem reviewedActionItem(ActionItem item, Map<String, MeetingAuditLog> changes,
            String errorPrefix) {
        // Công việc thiếu audit có thể chưa được gửi trong request Review Save.
        if (changes == null || item.getTaskName() == null || item.getTaskName().isBlank()) {
            throw conflict(errorPrefix, "ACTION_ITEMS_NOT_CONFIRMED",
                    "Không thể xác nhận Action Item có nội dung đã được Review-Save");
        }
        confirmField(changes.get("title"), item.getTaskName(), errorPrefix);
        return new ReviewedActionItem(item.getTaskName(),
                confirmedOptionalField(changes.get("assigneeName"), item.getAssigneeName(), errorPrefix),
                confirmedOptionalField(changes.get("deadlineRaw"), item.getDeadlineRaw(), errorPrefix),
                confirmedOptionalField(changes.get("dueDate"), item.getDueDate(), errorPrefix),
                Objects.toString(item.getStatus(), ""));
    }

    private static String confirmedOptionalField(MeetingAuditLog change, Object value, String errorPrefix) {
        // Trường tùy chọn chỉ xuất khi có audit tương ứng. Giá trị đã xóa được xuất thành ô trống.
        confirmField(change, value, errorPrefix);
        return change == null ? "" : Objects.toString(value, "");
    }

    private static void confirmField(MeetingAuditLog change, Object value, String errorPrefix) {
        if (change != null && !Objects.equals(change.getNewValue(), Objects.toString(value, null))) {
            throw reviewDataChanged(errorPrefix);
        }
    }

    private static BusinessException reviewDataChanged(String errorPrefix) {
        return conflict(errorPrefix, "REVIEW_DATA_MISMATCH", "Giá trị đã lưu không còn khớp với dữ liệu Review-Save");
    }

    private static BusinessException reviewNotConfirmed(String errorPrefix) {
        return conflict(errorPrefix, "REVIEW_NOT_CONFIRMED",
                "Không có Audit Log để xác nhận Review-Save thành công cho dữ liệu export");
    }

    private static BusinessException conflict(String errorPrefix, String code, String message) {
        return new BusinessException(HttpStatus.CONFLICT, errorPrefix + "_" + code, message);
    }

    record ReviewedMeetingReport(UUID meetingId, String title, Instant createdAt, String executiveSummary,
            List<ReviewedActionItem> actionItems) {}

    record ReviewedActionItem(String title, String assigneeName, String deadlineRaw, String dueDate, String status) {
        String deadline() {
            return Stream.of(deadlineRaw, dueDate).filter(value -> !value.isBlank()).collect(Collectors.joining(" / "));
        }
    }
}
