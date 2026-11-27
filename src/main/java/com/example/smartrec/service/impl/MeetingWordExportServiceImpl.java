package com.example.smartrec.service.impl;

import java.io.ByteArrayInputStream;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
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
import com.example.smartrec.model.dto.WordExportRequest;
import com.example.smartrec.model.dto.WordExportResponse;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingAuditLogRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.service.MeetingService;
import com.example.smartrec.service.MeetingService.MeetingDownloadFile;
import com.example.smartrec.service.MeetingWordExportService;
import com.example.smartrec.service.WordExporterService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class MeetingWordExportServiceImpl implements MeetingWordExportService {
    private static final String REVIEW_SAVE_EVENT = "HUMAN_REVIEW_SAVE";
    private static final String SUMMARY_ENTITY = "SUMMARY";
    private static final String ACTION_ITEM_ENTITY = "ACTION_ITEM";
    private static final Set<String> ACTION_ITEM_FIELDS = Set.of("title", "assigneeName", "dueDate", "deadlineRaw");
    private static final String DOCX_MIME_TYPE =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    private final MeetingService meetingService;
    private final JobRepository jobRepository;
    private final MeetingAuditLogRepository auditLogRepository;
    private final SummaryRepository summaryRepository;
    private final ActionItemRepository actionItemRepository;
    private final WordExporterService wordExporterService;

    // Chưa có template trong source; đây là đường dẫn mặc định cần bổ sung khi có file mẫu.
    @Value("${smartrec.word-export.template:classpath:templates/meeting-report.docx}")
    private Resource template;

    @Override
    // Đọc quyền, audit và kết quả từ cùng một snapshot khi Review-Save chạy đồng thời.
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public MeetingDownloadFile exportWord(UUID meetingId) {
        // Kiểm tra quyền Meeting bằng service hiện có trước khi đọc dữ liệu review và kết quả.
        MeetingResponseDTO meeting = meetingService.getMeeting(meetingId);

        // Chọn phiên bản gần nhất có audit; activeJobId có thể đang trỏ tới kết quả AI mới hơn chưa review.
        MeetingAuditLog latestReviewChange = auditLogRepository
                .findFirstByMeetingIdAndEventTypeAndJobIdIsNotNullOrderByCreatedAtDesc(
                        meetingId, REVIEW_SAVE_EVENT)
                .orElseThrow(this::reviewNotConfirmed);
        UUID reviewedJobId = latestReviewChange.getJobId();
        Job reviewedJob = jobRepository.findById(reviewedJobId)
                .filter(job -> meetingId.equals(job.getMeetingId()))
                .orElseThrow(() -> new BusinessException(HttpStatus.CONFLICT,
                        "MEETING_WORD_EXPORT_JOB_SCOPE_MISMATCH",
                        "Dữ liệu review không thuộc đúng cuộc họp"));
        if (reviewedJob.getStatus() != JobStatus.COMPLETED) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEETING_WORD_EXPORT_JOB_NOT_COMPLETED",
                    "Job đã review không ở trạng thái hoàn tất");
        }

        List<MeetingAuditLog> reviewChanges = auditLogRepository
                .findByMeetingIdAndJobIdAndEventTypeOrderByCreatedAtDesc(meetingId, reviewedJobId, REVIEW_SAVE_EVENT);

        Summary summary = summaryRepository.findByProcessingJobId(reviewedJobId)
                .filter(value -> meetingId.equals(value.getMeetingId())
                        && reviewedJobId.equals(value.getProcessingJobId()))
                .orElseThrow(() -> new ResourceNotFoundException("MEETING_WORD_EXPORT_SUMMARY_NOT_FOUND",
                        "Không tìm thấy Summary thuộc phiên bản đã review"));
        if (summary.getExecutiveSummary() == null || summary.getExecutiveSummary().isBlank()) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEETING_WORD_EXPORT_SUMMARY_EMPTY",
                    "Summary đã review không có nội dung để export");
        }
        MeetingAuditLog summaryChange = reviewChanges.stream()
                .filter(change -> SUMMARY_ENTITY.equals(change.getEntityType())
                        && "executiveSummary".equals(change.getFieldName()))
                .findFirst().orElse(null);
        if (summaryChange != null && !Objects.equals(summary.getId(), summaryChange.getEntityId())) {
            throw reviewDataChanged();
        }
        confirmField(summaryChange, summary.getExecutiveSummary());

        List<ActionItem> actionItems = actionItemRepository.findByProcessingJobId(reviewedJobId);
        if (actionItems.stream().anyMatch(item -> !meetingId.equals(item.getMeetingId())
                || !reviewedJobId.equals(item.getProcessingJobId()))) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEETING_WORD_EXPORT_DATA_SCOPE_MISMATCH",
                    "Có Action Item không thuộc cùng cuộc họp và phiên bản review");
        }

        Map<UUID, Map<String, MeetingAuditLog>> itemChanges = latestActionItemChanges(reviewChanges);
        // Summary là bắt buộc trong Review-Save, kể cả khi chỉ có Action Item sinh audit.
        if (summaryChange == null && actionItems.isEmpty()) {
            throw reviewNotConfirmed();
        }

        String tasks = actionItems.stream()
                .sorted(Comparator.comparing(ActionItem::getId))
                .map(item -> formatActionItem(item, itemChanges.get(item.getId())))
                .collect(Collectors.joining("\n"));
        Map<String, String> values = Map.of(
                "{{MEETING_TITLE}}", Objects.toString(meeting.getTitle(), ""),
                "{{MEETING_ID}}", meetingId.toString(),
                "{{MEETING_CREATED_AT}}", Objects.toString(meeting.getCreatedAt(), ""),
                "{{APPROVED_SUMMARY}}", summary.getExecutiveSummary(),
                "{{APPROVED_ACTION_ITEMS}}", tasks);

        WordExportResponse exported = wordExporterService.exportWord(new WordExportRequest(template, values));
        byte[] content = exported.content();
        return new MeetingDownloadFile("meeting-report-" + meetingId + ".docx",
                DOCX_MIME_TYPE, (long) content.length, new ByteArrayInputStream(content));
    }

    private static Map<UUID, Map<String, MeetingAuditLog>> latestActionItemChanges(List<MeetingAuditLog> changes) {
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

    private String formatActionItem(ActionItem item, Map<String, MeetingAuditLog> changes) {
        // Audit chỉ ghi trường thay đổi. Task chưa có bằng chứng có thể đã bị lược khỏi request.
        if (changes == null || item.getTaskName() == null || item.getTaskName().isBlank()) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEETING_WORD_EXPORT_ACTION_ITEMS_NOT_CONFIRMED",
                    "Không thể xác nhận Action Item có nội dung đã được Review-Save");
        }
        confirmField(changes.get("title"), item.getTaskName());
        String owner = confirmedOptionalField(changes.get("assigneeName"), item.getAssigneeName());
        String deadlineText = confirmedOptionalField(changes.get("deadlineRaw"), item.getDeadlineRaw());
        String deadlineDate = confirmedOptionalField(changes.get("dueDate"), item.getDueDate());
        String deadline = Stream.of(deadlineText, deadlineDate)
                .filter(value -> !value.isBlank()).collect(Collectors.joining(" / "));
        return "- " + item.getTaskName() + " | Owner: " + owner + " | Deadline: " + deadline
                + " | Status: " + Objects.toString(item.getStatus(), "");
    }

    private static String confirmedOptionalField(MeetingAuditLog change, Object value) {
        confirmField(change, value);
        return change == null ? "" : Objects.toString(value, "");
    }

    private static void confirmField(MeetingAuditLog change, Object value) {
        if (change != null && !Objects.equals(change.getNewValue(), Objects.toString(value, null))) {
            throw reviewDataChanged();
        }
    }

    private static BusinessException reviewDataChanged() {
        return new BusinessException(HttpStatus.CONFLICT, "MEETING_WORD_EXPORT_REVIEW_DATA_MISMATCH",
                "Giá trị đã lưu không còn khớp với dữ liệu Review-Save");
    }

    private BusinessException reviewNotConfirmed() {
        return new BusinessException(HttpStatus.CONFLICT, "MEETING_WORD_EXPORT_REVIEW_NOT_CONFIRMED",
                "Không có Audit Log để xác nhận Review-Save thành công cho dữ liệu export");
    }
}
