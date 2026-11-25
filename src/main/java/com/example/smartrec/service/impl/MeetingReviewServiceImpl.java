package com.example.smartrec.service.impl;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.MeetingReviewSaveRequest;
import com.example.smartrec.model.dto.MeetingReviewSaveRequest.TaskDraft;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.service.MeetingAuditLogService;
import com.example.smartrec.service.MeetingReviewService;
import com.fasterxml.jackson.databind.JsonNode;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class MeetingReviewServiceImpl implements MeetingReviewService {
    private final MeetingAuditLogService auditService;
    private final SummaryRepository summaries;
    private final ActionItemRepository actionItems;
    private final EntityManager entityManager;

    @Override
    @Transactional
    public void saveReview(UUID meetingId, MeetingReviewSaveRequest request) {
        UUID jobId = request.getJobId();
        // Chuẩn hóa field và phát hiện ID lặp trước khi mở callback lưu cùng audit.
        Map<UUID, TaskUpdate> tasks = indexTasks(request.getActionItems());

        // Audit xác minh actor, quyền Meeting và phạm vi record, rồi chụp giá trị cũ trước callback.
        // Nếu lưu hoặc ghi audit lỗi, transaction hiện tại rollback cả hai phần.
        auditService.auditReviewSave(meetingId, jobId, tasks.keySet(), () -> {
            requireCompletedActiveJob(meetingId, jobId);
            summaries.findByProcessingJobId(jobId).orElseThrow()
                    .setExecutiveSummary(request.getSummary().getExecutiveSummary());
            // Chỉ tải và cập nhật các task được gửi. Những task vắng mặt được giữ nguyên.
            actionItems.findAllById(tasks.keySet()).forEach(item -> applyTask(item, tasks.get(item.getId())));
        });
    }

    private Map<UUID, TaskUpdate> indexTasks(List<TaskDraft> drafts) {
        Map<UUID, TaskUpdate> tasks = new LinkedHashMap<>();
        for (TaskDraft draft : drafts) {
            TaskUpdate task = parseTask(draft);
            // Không cho cùng một bản ghi nhận hai bộ giá trị khác nhau trong một request.
            if (tasks.putIfAbsent(draft.getId(), task) != null) {
                throw invalidTask("actionItems: ID công việc bị lặp");
            }
        }
        return tasks;
    }

    private TaskUpdate parseTask(TaskDraft draft) {
        // Kiểm kiểu JsonNode tại service vì DTO cần giữ trạng thái bỏ qua và null tường minh.
        String assigneeName = blankToNull(optionalText(draft.getAssigneeName(), "assigneeName"));
        if (assigneeName != null && assigneeName.length() > 255) {
            throw invalidTask("actionItems.assigneeName: tối đa 255 ký tự");
        }
        String deadlineRaw = optionalText(draft.getDeadlineRaw(), "deadlineRaw");
        String date = optionalText(draft.getDueDate(), "dueDate");
        Instant dueDate;
        try {
            // Lưu thời điểm tuyệt đối để offset từ các múi giờ khác nhau cho cùng một giá trị.
            dueDate = date == null ? null : OffsetDateTime.parse(date).toInstant();
        } catch (DateTimeParseException ex) {
            throw invalidTask("actionItems.dueDate: ngày giờ phải theo ISO-8601 và có offset");
        }
        return new TaskUpdate(draft, assigneeName, dueDate, blankToNull(deadlineRaw));
    }

    private String optionalText(JsonNode value, String field) {
        // Field vắng mặt và JSON null có cùng giá trị Java null sau khi đọc.
        // applyTask kiểm tra JsonNode gốc để chỉ xóa khi client gửi null tường minh.
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual()) {
            throw invalidTask("actionItems." + field + ": phải là chuỗi hoặc null");
        }
        return value.textValue();
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private BusinessException invalidTask(String detail) {
        return new BusinessException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Dữ liệu không hợp lệ",
                List.of(detail));
    }

    private void requireCompletedActiveJob(UUID meetingId, UUID jobId) {
        Job job = entityManager.find(Job.class, jobId);
        Meeting meeting = entityManager.find(Meeting.class, meetingId);
        // Meeting và quyền owner đã được kiểm tra trong audit service. Refresh dưới khóa ghi để xác nhận
        // Job vẫn active và ngăn đổi active_job_id cho tới khi transaction lưu review kết thúc.
        entityManager.refresh(meeting, LockModeType.PESSIMISTIC_WRITE);
        if (!jobId.equals(meeting.getActive_job_id()) || job.getStatus() != JobStatus.COMPLETED) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEETING_REVIEW_JOB_NOT_READY",
                    "Chỉ có thể lưu review cho Job hiện hành đã hoàn thành");
        }
    }

    private void applyTask(ActionItem item, TaskUpdate task) {
        TaskDraft draft = task.draft();
        // Chỉ cho đổi assigneeName thủ công khi task chưa liên kết danh tính Speaker hoặc User.
        if (draft.getAssigneeName() != null && !Objects.equals(item.getAssigneeName(), task.assigneeName())) {
            if (item.getAssigneeSpeakerId() != null || item.getAssigneeUserId() != null) {
                throw new BusinessException(HttpStatus.CONFLICT, "MEETING_REVIEW_ASSIGNEE_LINKED",
                        "Không thể đổi tên người phụ trách đã liên kết với Speaker hoặc User");
            }
            item.setAssigneeName(task.assigneeName());
        }
        item.setTaskName(draft.getTitle());
        // JsonNode null là thao tác xóa, JsonNode Java null là field bị bỏ qua.
        if (draft.getDueDate() != null) {
            item.setDueDate(task.dueDate());
        }
        if (draft.getDeadlineRaw() != null) {
            item.setDeadlineRaw(task.deadlineRaw());
        }
    }

    private record TaskUpdate(TaskDraft draft, String assigneeName, Instant dueDate, String deadlineRaw) {}
}
