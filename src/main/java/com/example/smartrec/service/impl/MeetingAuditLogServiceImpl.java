package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import jakarta.persistence.EntityManager;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.MeetingAuditLog;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.ResourceNotFoundException;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingAuditLogRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.MeetingAuditLogService;
import com.example.smartrec.service.MeetingService;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class MeetingAuditLogServiceImpl implements MeetingAuditLogService {
    private static final String REVIEW_SAVE = "HUMAN_REVIEW_SAVE";

    private final MeetingService meetingService;
    private final UserRepository userRepository;
    private final JobRepository jobRepository;
    private final SummaryRepository summaryRepository;
    private final ActionItemRepository actionItemRepository;
    private final MeetingAuditLogRepository auditRepository;
    private final EntityManager entityManager;

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void auditReviewSave(UUID meetingId, UUID jobId, Set<UUID> actionItemIds, Runnable saveReview) {
        // Audit phải tham gia transaction ghi hiện tại để có thể rollback cùng Review-Save.
        if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            throw new IllegalTransactionStateException("Review audit requires a write transaction");
        }
        if (meetingId == null || jobId == null || actionItemIds == null || saveReview == null
                || actionItemIds.stream().anyMatch(Objects::isNull)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Dữ liệu không hợp lệ");
        }
        Set<UUID> ids = Set.copyOf(actionItemIds);

        // Lấy actor từ Security Context, không nhận danh tính người dùng từ request.
        UUID actorId = currentActorId();

        // Kiểm tra quyền với Meeting trước khi đọc Summary hoặc ActionItem.
        meetingService.getMeeting(meetingId);

        // Dùng khóa của AIResultService và xác minh job thuộc đúng Meeting.
        jobRepository.findByIdForUpdate(jobId)
                .filter(job -> meetingId.equals(job.getMeetingId()))
                .orElseThrow(() -> new ResourceNotFoundException("MEETING_JOB_NOT_FOUND",
                        "Không tìm thấy Job thuộc cuộc họp"));

        // Lưu snapshot bất biến trước callback vì repository trả lại entity đang được JPA quản lý.
        SummarySnapshot summaryBefore = SummarySnapshot.from(loadSummary(meetingId, jobId));
        Map<UUID, ActionItemSnapshot> itemsBefore = loadActionItems(meetingId, jobId, ids, false);

        // Chỉ chạy thao tác lưu sau khi actor, quyền và phạm vi dữ liệu đã được xác minh.
        saveReview.run();

        // Flush và refresh để so sánh với giá trị PostgreSQL thực sự lưu, kể cả độ chính xác timestamp.
        auditRepository.flush();
        Summary savedSummary = loadSummary(meetingId, jobId);
        entityManager.refresh(savedSummary);
        SummarySnapshot summaryAfter = SummarySnapshot.from(savedSummary);
        Map<UUID, ActionItemSnapshot> itemsAfter = loadActionItems(meetingId, jobId, ids, true);
        if (!summaryBefore.id().equals(summaryAfter.id())) {
            throw scopeMismatch();
        }

        // Tạo một bản ghi cho mỗi trường có giá trị cũ và mới khác nhau.
        List<MeetingAuditLog> changes = new ArrayList<>();
        addChange(changes, meetingId, actorId, "SUMMARY", summaryBefore.id(),
                "executiveSummary", summaryBefore.executiveSummary(), summaryAfter.executiveSummary());
        itemsBefore.forEach((id, before) -> {
            ActionItemSnapshot after = itemsAfter.get(id);
            addChange(changes, meetingId, actorId, "ACTION_ITEM", id, "title", before.title(), after.title());
            addChange(changes, meetingId, actorId, "ACTION_ITEM", id, "assigneeName",
                    before.assigneeName(), after.assigneeName());
            addChange(changes, meetingId, actorId, "ACTION_ITEM", id, "dueDate", before.dueDate(), after.dueDate());
            addChange(changes, meetingId, actorId, "ACTION_ITEM", id, "deadlineRaw",
                    before.deadlineRaw(), after.deadlineRaw());
        });
        if (!changes.isEmpty()) {
            // Lưu trong cùng transaction với thao tác Review ở trên.
            auditRepository.saveAll(changes);
        }
    }

    private Summary loadSummary(UUID meetingId, UUID jobId) {
        return summaryRepository.findByProcessingJobId(jobId)
                .filter(summary -> meetingId.equals(summary.getMeetingId()))
                .orElseThrow(() -> new ResourceNotFoundException("MEETING_SUMMARY_NOT_FOUND",
                        "Không tìm thấy bản tóm tắt thuộc Meeting/Job"));
    }

    private Map<UUID, ActionItemSnapshot> loadActionItems(
            UUID meetingId, UUID jobId, Set<UUID> ids, boolean refreshFromDatabase) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        List<ActionItem> items = new ArrayList<>();
        actionItemRepository.findAllById(ids).forEach(items::add);
        if (items.size() != ids.size()) {
            throw scopeMismatch();
        }
        if (items.stream().anyMatch(item -> !meetingId.equals(item.getMeetingId())
                || !jobId.equals(item.getProcessingJobId()))) {
            throw scopeMismatch();
        }
        if (refreshFromDatabase) {
            items.forEach(entityManager::refresh);
        }
        return items.stream().collect(Collectors.toMap(ActionItem::getId, ActionItemSnapshot::from));
    }

    private record SummarySnapshot(UUID id, String executiveSummary) {
        private static SummarySnapshot from(Summary summary) {
            return new SummarySnapshot(summary.getId(), summary.getExecutiveSummary());
        }
    }

    private record ActionItemSnapshot(String title, String assigneeName, Instant dueDate, String deadlineRaw) {
        private static ActionItemSnapshot from(ActionItem item) {
            return new ActionItemSnapshot(item.getTaskName(), item.getAssigneeName(),
                    item.getDueDate(), item.getDeadlineRaw());
        }
    }

    private BusinessException scopeMismatch() {
        return new BusinessException(HttpStatus.CONFLICT, "MEETING_RESULT_SCOPE_MISMATCH",
                "Dữ liệu kết quả không thuộc Meeting/Job được yêu cầu");
    }

    private UUID currentActorId() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken || authentication.getName() == null) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Yêu cầu đăng nhập");
        }
        if (authentication.getAuthorities().stream().anyMatch(role -> "ROLE_GUEST".equals(role.getAuthority()))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, "MEETING_ACCESS_DENIED",
                    "Bạn không có quyền truy cập cuộc họp này");
        }
        String identifier = authentication.getName();
        return userRepository.findByEmail(identifier).or(() -> userRepository.findByPhone(identifier))
                .map(User::getId)
                .orElseThrow(() -> new BusinessException(HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND",
                        "Không tìm thấy người dùng đăng nhập"));
    }

    private void addChange(List<MeetingAuditLog> changes, UUID meetingId, UUID actorId, String entityType,
            UUID entityId, String field, Object oldValue, Object newValue) {
        if (!Objects.equals(oldValue, newValue)) {
            MeetingAuditLog audit = new MeetingAuditLog();
            audit.setMeetingId(meetingId);
            audit.setEventType(REVIEW_SAVE);
            audit.setEntityType(entityType);
            audit.setEntityId(entityId);
            audit.setFieldName(field);
            audit.setOldValue(Objects.toString(oldValue, null));
            audit.setNewValue(Objects.toString(newValue, null));
            audit.setActorId(actorId);
            changes.add(audit);
        }
    }
}
