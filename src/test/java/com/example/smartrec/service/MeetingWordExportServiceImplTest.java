package com.example.smartrec.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.MeetingAuditLog;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.WordExportRequest;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingAuditLogRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.service.impl.MeetingWordExportServiceImpl;
import com.example.smartrec.service.impl.ReviewedMeetingReportReader;
import com.example.smartrec.service.impl.WordExporterServiceImpl;

@ExtendWith(MockitoExtension.class)
class MeetingWordExportServiceImplTest {
    private static final UUID MEETING_ID = UUID.randomUUID();
    private static final UUID REVIEWED_JOB_ID = UUID.randomUUID();
    private static final UUID NEWER_AI_JOB_ID = UUID.randomUUID();
    private static final UUID SUMMARY_ID = UUID.randomUUID();
    private static final UUID ACTION_ITEM_ID = UUID.randomUUID();

    @Mock MeetingService meetingService;
    @Mock JobRepository jobRepository;
    @Mock MeetingAuditLogRepository auditLogRepository;
    @Mock SummaryRepository summaryRepository;
    @Mock ActionItemRepository actionItemRepository;
    @Mock WordExporterService wordExporterService;
    MeetingWordExportServiceImpl service;

    @BeforeEach
    void setUp() {
        // Chạy logic đọc dữ liệu dùng chung để test hồi quy Word kiểm tra cả quyền và điều kiện review.
        var reportReader = new ReviewedMeetingReportReader(meetingService, jobRepository, auditLogRepository,
                summaryRepository, actionItemRepository);
        service = new MeetingWordExportServiceImpl(reportReader, wordExporterService);
    }

    @Test
    void exportsPersistedVersionWithReviewEvidenceAndIgnoresNewerUnreviewedActiveJob() throws IOException {
        setUpAuthorizedMeeting(NEWER_AI_JOB_ID);
        setUpReviewedJob();
        Summary summary = summary("Tóm tắt đã duyệt\nChốt kế hoạch");
        ActionItem actionItem = actionItem("Gửi báo cáo", "Đỗ An");
        setUpReviewChanges(List.of(summaryChange(summary.getExecutiveSummary()),
                audit("ACTION_ITEM", ACTION_ITEM_ID, "title", actionItem.getTaskName()),
                audit("ACTION_ITEM", ACTION_ITEM_ID, "assigneeName", actionItem.getAssigneeName()),
                audit("ACTION_ITEM", ACTION_ITEM_ID, "dueDate", actionItem.getDueDate().toString()),
                summaryChange("Tóm tắt từ lần duyệt trước")));
        when(summaryRepository.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(Optional.of(summary));
        when(actionItemRepository.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(List.of(actionItem));
        ReflectionTestUtils.setField(service, "template", reportTemplate());
        when(wordExporterService.exportWord(org.mockito.ArgumentMatchers.any(WordExportRequest.class)))
                .thenAnswer(call -> new WordExporterServiceImpl().exportWord(call.getArgument(0)));

        var file = service.exportWord(MEETING_ID);

        var request = ArgumentCaptor.forClass(WordExportRequest.class);
        verify(wordExporterService).exportWord(request.capture());
        assertThat(request.getValue().values())
                .containsEntry("{{MEETING_TITLE}}", "Planning")
                .containsEntry("{{MEETING_ID}}", MEETING_ID.toString())
                .containsEntry("{{APPROVED_SUMMARY}}", summary.getExecutiveSummary())
                .containsEntry("{{APPROVED_ACTION_ITEMS}}",
                        "- Gửi báo cáo | Owner: Đỗ An | Deadline: 2026-12-10T00:00:00Z | Status: OPEN");
        assertThat(request.getValue().values().get("{{MEETING_CREATED_AT}}"))
                .isEqualTo("2026-11-25T09:30:00Z");
        assertThat(file.fileName()).isEqualTo("meeting-report-" + MEETING_ID + ".docx");
        assertThat(file.mimeType())
                .isEqualTo("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        try (var input = file.inputStream()) {
            assertThat(file.fileSizeBytes()).isEqualTo((long) input.available()).isPositive();
            try (var document = new XWPFDocument(input)) {
                assertThat(document.getParagraphArray(0).getText()).isEqualTo("Planning");
                assertThat(document.getParagraphArray(0).getRuns().get(0).isBold()).isTrue();
                assertThat(document.getParagraphArray(1).getText())
                        .isEqualTo(MEETING_ID + " / 2026-11-25T09:30:00Z");
                assertThat(document.getParagraphArray(2).getText()).isEqualTo(summary.getExecutiveSummary());
                assertThat(document.getTables().get(0).getRow(0).getCell(0).getText())
                        .isEqualTo("- Gửi báo cáo | Owner: Đỗ An | Deadline: 2026-12-10T00:00:00Z | Status: OPEN");
            }
        }
        verify(jobRepository).findById(REVIEWED_JOB_ID);
        verify(jobRepository, never()).findById(NEWER_AI_JOB_ID);
    }

    @Test
    void blocksWhenNoAuditCanConfirmThatReviewSaveSucceeded() {
        setUpAuthorizedMeeting(null);
        when(auditLogRepository.findFirstByMeetingIdAndEventTypeAndJobIdIsNotNullOrderByCreatedAtDesc(
                MEETING_ID, "HUMAN_REVIEW_SAVE")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.exportWord(MEETING_ID))
                .isInstanceOfSatisfying(BusinessException.class, error -> {
                    assertThat(error.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(error.getCode()).isEqualTo("MEETING_WORD_EXPORT_REVIEW_NOT_CONFIRMED");
                });
        verify(summaryRepository, never()).findByProcessingJobId(org.mockito.ArgumentMatchers.any());
        verify(wordExporterService, never()).exportWord(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void blocksInsteadOfExportingActionItemsWithoutReviewAuditEvidence() {
        setUpAuthorizedMeeting(REVIEWED_JOB_ID);
        setUpReviewedJob();
        Summary summary = summary("Stored reviewed summary");
        ActionItem itemWithoutEvidence = actionItem("AI task", "AI owner");
        setUpReviewChanges(List.of(summaryChange(summary.getExecutiveSummary())));
        when(summaryRepository.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(Optional.of(summary));
        when(actionItemRepository.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(List.of(itemWithoutEvidence));

        assertThatThrownBy(() -> service.exportWord(MEETING_ID))
                .isInstanceOfSatisfying(BusinessException.class, error -> {
                    assertThat(error.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(error.getCode()).isEqualTo("MEETING_WORD_EXPORT_ACTION_ITEMS_NOT_CONFIRMED");
                });
        verify(wordExporterService, never()).exportWord(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void rejectsUnauthorizedMeetingBeforeReadingAuditOrResults() {
        var denied = new BusinessException(HttpStatus.FORBIDDEN, "MEETING_ACCESS_DENIED", "Access denied");
        when(meetingService.getMeeting(MEETING_ID)).thenThrow(denied);

        assertThatThrownBy(() -> service.exportWord(MEETING_ID)).isSameAs(denied);
        verifyNoInteractions(auditLogRepository, jobRepository, summaryRepository,
                actionItemRepository, wordExporterService);
    }

    @Test
    void rejectsActionItemFromDifferentMeeting() {
        setUpAuthorizedMeeting(REVIEWED_JOB_ID);
        setUpReviewedJob();
        Summary summary = summary("Reviewed summary");
        ActionItem item = actionItem("Task", "Owner");
        item.setMeetingId(UUID.randomUUID());
        setUpReviewChanges(List.of(summaryChange(summary.getExecutiveSummary())));
        when(summaryRepository.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(Optional.of(summary));
        when(actionItemRepository.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(List.of(item));

        assertExportFailure(HttpStatus.CONFLICT, "MEETING_WORD_EXPORT_DATA_SCOPE_MISMATCH");
    }

    @Test
    void rejectsSummaryThatDoesNotMatchLatestAuditValue() {
        setUpAuthorizedMeeting(REVIEWED_JOB_ID);
        setUpReviewedJob();
        setUpReviewChanges(List.of(summaryChange("Reviewed version")));
        when(summaryRepository.findByProcessingJobId(REVIEWED_JOB_ID))
                .thenReturn(Optional.of(summary("Current unaudited text")));

        assertExportFailure(HttpStatus.CONFLICT, "MEETING_WORD_EXPORT_REVIEW_DATA_MISMATCH");
    }

    @Test
    void rejectsActionItemWhenCurrentOwnerDiffersFromAudit() {
        setUpAuthorizedMeeting(REVIEWED_JOB_ID);
        setUpReviewedJob();
        Summary summary = summary("Reviewed summary");
        ActionItem item = actionItem("Reviewed task", "Unaudited owner");
        setUpReviewChanges(List.of(summaryChange(summary.getExecutiveSummary()),
                audit("ACTION_ITEM", ACTION_ITEM_ID, "assigneeName", "Reviewed owner")));
        when(summaryRepository.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(Optional.of(summary));
        when(actionItemRepository.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(List.of(item));

        assertExportFailure(HttpStatus.CONFLICT, "MEETING_WORD_EXPORT_REVIEW_DATA_MISMATCH");
    }

    private void assertExportFailure(HttpStatus status, String code) {
        assertThatThrownBy(() -> service.exportWord(MEETING_ID))
                .isInstanceOfSatisfying(BusinessException.class, error -> {
                    assertThat(error.getStatus()).isEqualTo(status);
                    assertThat(error.getCode()).isEqualTo(code);
                });
        verifyNoInteractions(wordExporterService);
    }

    private void setUpAuthorizedMeeting(UUID activeJobId) {
        MeetingResponseDTO response = new MeetingResponseDTO(MEETING_ID, "Planning", null,
                null, null, null, null, null, Instant.parse("2026-11-25T09:30:00Z"), null, activeJobId);
        when(meetingService.getMeeting(MEETING_ID)).thenReturn(response);
    }

    private void setUpReviewedJob() {
        Job reviewedJob = Job.builder()
                .id(REVIEWED_JOB_ID)
                .meetingId(MEETING_ID)
                .status(JobStatus.COMPLETED)
                .build();
        when(jobRepository.findById(REVIEWED_JOB_ID)).thenReturn(Optional.of(reviewedJob));
    }

    private Summary summary(String text) {
        Summary summary = new Summary();
        summary.setId(SUMMARY_ID);
        summary.setMeetingId(MEETING_ID);
        summary.setProcessingJobId(REVIEWED_JOB_ID);
        summary.setExecutiveSummary(text);
        return summary;
    }

    private ActionItem actionItem(String title, String owner) {
        ActionItem item = new ActionItem();
        item.setId(ACTION_ITEM_ID);
        item.setMeetingId(MEETING_ID);
        item.setProcessingJobId(REVIEWED_JOB_ID);
        item.setTaskName(title);
        item.setAssigneeName(owner);
        item.setStatus("OPEN");
        item.setDeadlineRaw("unreviewed AI deadline");
        item.setDueDate(Instant.parse("2026-12-10T00:00:00Z"));
        return item;
    }

    private void setUpReviewChanges(List<MeetingAuditLog> changes) {
        when(auditLogRepository.findFirstByMeetingIdAndEventTypeAndJobIdIsNotNullOrderByCreatedAtDesc(
                MEETING_ID, "HUMAN_REVIEW_SAVE")).thenReturn(Optional.of(changes.get(0)));
        when(auditLogRepository.findByMeetingIdAndJobIdAndEventTypeOrderByCreatedAtDesc(
                MEETING_ID, REVIEWED_JOB_ID, "HUMAN_REVIEW_SAVE")).thenReturn(changes);
    }

    private MeetingAuditLog summaryChange(String newValue) {
        return audit("SUMMARY", SUMMARY_ID, "executiveSummary", newValue);
    }

    private MeetingAuditLog audit(String entityType, UUID entityId, String fieldName, String newValue) {
        MeetingAuditLog log = new MeetingAuditLog();
        log.setMeetingId(MEETING_ID);
        log.setJobId(REVIEWED_JOB_ID);
        log.setEventType("HUMAN_REVIEW_SAVE");
        log.setEntityType(entityType);
        log.setEntityId(entityId);
        log.setFieldName(fieldName);
        log.setNewValue(newValue);
        log.setCreatedAt(Instant.parse("2026-11-25T10:00:00Z"));
        return log;
    }

    private static ByteArrayResource reportTemplate() throws IOException {
        try (var document = new XWPFDocument(); var bytes = new ByteArrayOutputStream()) {
            var title = document.createParagraph().createRun();
            title.setText("{{MEETING_TITLE}}");
            title.setBold(true);
            document.createParagraph().createRun().setText("{{MEETING_ID}} / {{MEETING_CREATED_AT}}");
            document.createParagraph().createRun().setText("{{APPROVED_SUMMARY}}");
            document.createTable(1, 1).getRow(0).getCell(0).setText("{{APPROVED_ACTION_ITEMS}}");
            document.write(bytes);
            return new ByteArrayResource(bytes.toByteArray());
        }
    }
}
