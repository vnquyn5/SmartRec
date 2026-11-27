package com.example.smartrec.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.example.smartrec.config.SecurityConfig;
import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingAuditLog;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.FolderRepository;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingAuditLogRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.PublicShareLinkRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.security.JwtService;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.impl.MeetingReportExportServiceImpl;
import com.example.smartrec.service.impl.MeetingServiceImpl;
import com.example.smartrec.service.impl.ReviewedMeetingReportReader;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

// Dùng JWT filter, service và bộ tạo tệp thật. Repository mô phỏng dữ liệu các phiên bản review.
@WebMvcTest(controllers = ExportReportController.class, properties = {
        "app.cors.allowed-origins=http://localhost:5173", "jwt.secret=" + ExportReportControllerTest.SECRET
})
@Import({SecurityConfig.class, JwtService.class, MeetingReportExportServiceImpl.class,
        ReviewedMeetingReportReader.class, MeetingServiceImpl.class})
@MockBean({PublicShareLinkRepository.class, FolderRepository.class, MediaFileRepository.class, MinioService.class})
class ExportReportControllerTest {
    static final String SECRET = "smartrec-export-test-signing-key-for-jwt-only";
    private static final UUID MEETING_ID = UUID.randomUUID();
    private static final UUID WORKSPACE_ID = UUID.randomUUID();
    private static final UUID REVIEWED_JOB_ID = UUID.randomUUID();
    private static final UUID ACTIVE_JOB_ID = UUID.randomUUID();
    private static final UUID SUMMARY_ID = UUID.randomUUID();
    private static final Instant CREATED_AT = Instant.parse("2026-11-25T09:30:00Z");
    private static final String EMAIL = "user@example.com";
    private static final String ROUTE = "/meetings/" + MEETING_ID + "/export";
    private static final String REVIEW_EVENT = "HUMAN_REVIEW_SAVE";
    private static final String CSV_TYPE = "text/csv;charset=UTF-8";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @MockBean UserRepository users;
    @MockBean MeetingRepository meetings;
    @MockBean JobRepository jobs;
    @MockBean MeetingAuditLogRepository audits;
    @MockBean SummaryRepository summaries;
    @MockBean ActionItemRepository items;

    @Test
    void downloadsPaginatedVietnamesePdfFromTheReviewedJob() throws Exception {
        seedMeeting("Họp kế hoạch quý");
        String longWord = "D".repeat(350);
        String summary = "Thống nhất kế hoạch triển khai.\n"
                + "Trao đổi nội dung và các mốc thực hiện.\n".repeat(85) + longWord + "\nKết thúc 😀";
        var tasks = new ArrayList<ActionItem>();
        var changes = new ArrayList<MeetingAuditLog>();
        for (int number = 1; number <= 30; number++) {
            var task = task(number, "Gửi báo cáo số " + number);
            tasks.add(task);
            changes.add(audit("ACTION_ITEM", task.getId(), "title", task.getTaskName()));
        }
        var firstTask = tasks.get(0);
        firstTask.setAssigneeName("Đỗ Thị Ánh");
        firstTask.setDueDate(Instant.parse("2026-12-10T00:00:00Z"));
        firstTask.setDeadlineRaw("Hạn cũ chưa xác nhận");
        changes.add(audit("ACTION_ITEM", firstTask.getId(), "assigneeName", firstTask.getAssigneeName()));
        changes.add(audit("ACTION_ITEM", firstTask.getId(), "dueDate", firstTask.getDueDate().toString()));
        seedReview(summary, tasks, changes);

        byte[] bytes = downloaded("PDF", MediaType.APPLICATION_PDF_VALUE);
        try (var pdf = Loader.loadPDF(bytes)) {
            assertThat(pdf.getNumberOfPages()).isGreaterThan(2);
            var pageResources = pdf.getPage(0).getResources();
            assertThat(pageResources.getFont(pageResources.getFontNames().iterator().next()).isEmbedded()).isTrue();
            String text = new PDFTextStripper().getText(pdf);
            assertThat(text).contains("Họp kế hoạch quý", MEETING_ID.toString(), CREATED_AT.toString(),
                    "Thống nhất kế hoạch triển khai.", "Người phụ trách: Đỗ Thị Ánh",
                    "Hạn hoàn thành: 2026-12-10T00:00:00Z", "30. Gửi báo cáo số 30", "Trạng thái: OPEN",
                    "Kết thúc �").doesNotContain("Hạn cũ chưa xác nhận");
            assertThat(text.replaceAll("\\s", "")).contains(longWord);
        }
        verify(jobs, never()).findById(ACTIVE_JOB_ID);
    }

    @Test
    void downloadsUtf8CsvWithQuotedCellsAndFormulaProtection() throws Exception {
        seedMeeting("Họp, \"tháng 11\"");
        String summary = "Dòng thứ nhất\r\nDòng thứ hai";
        var task = task(1, "  =1+1");
        task.setDeadlineRaw("Thứ sáu, \"cuối ngày\"\nGiờ Hà Nội");
        seedReview(summary, List.of(task), List.of(
                audit("ACTION_ITEM", task.getId(), "title", task.getTaskName()),
                audit("ACTION_ITEM", task.getId(), "deadlineRaw", task.getDeadlineRaw())));

        byte[] bytes = downloaded("csv", CSV_TYPE);
        assertThat(bytes).startsWith((byte) 0xef, (byte) 0xbb, (byte) 0xbf);
        assertThat(new String(bytes, StandardCharsets.UTF_8)).isEqualTo(
                "\uFEFFrecord_type,meeting_id,meeting_title,meeting_created_at,executive_summary,action_item_title,"
                + "assignee_name,deadline_raw,due_date,status\r\n"
                + "\"meeting\",\"" + MEETING_ID + "\",\"Họp, \"\"tháng 11\"\"\",\"" + CREATED_AT
                + "\",\"" + summary + "\",\"\",\"\",\"\",\"\",\"\"\r\n"
                + "\"action_item\",\"" + MEETING_ID + "\",\"\",\"\",\"\",\"'  =1+1\",\"\","
                + "\"Thứ sáu, \"\"cuối ngày\"\"\nGiờ Hà Nội\",\"\",\"OPEN\"\r\n");
    }

    @Test
    void exportsSummaryWithoutActionItemsInBothFormats() throws Exception {
        seedMeeting("Họp nhóm");
        seedReview("Tóm tắt đã lưu", List.of(), List.of());

        var csv = new String(downloaded("csv", CSV_TYPE), StandardCharsets.UTF_8);
        assertThat(csv.lines().toList()).hasSize(2);
        assertThat(csv).contains("Tóm tắt đã lưu");
        try (var pdf = Loader.loadPDF(downloaded("pdf", MediaType.APPLICATION_PDF_VALUE))) {
            assertThat(new PDFTextStripper().getText(pdf)).contains("Tóm tắt đã lưu", "Không có công việc.");
        }
    }

    @Test
    void rejectsMissingOrUnsupportedFormatAndMalformedMeetingId() throws Exception {
        authenticate(WORKSPACE_ID);
        request(ROUTE, "docx").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_EXPORT_FORMAT"));
        request(ROUTE, " ").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_EXPORT_FORMAT"));
        mvc.perform(get(ROUTE).header(HttpHeaders.AUTHORIZATION, bearerToken()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MISSING_PARAMETER"));
        request("/meetings/unknown/export", "pdf").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER_FORMAT"));
        verifyNoInteractions(meetings, audits, jobs, summaries, items);
    }

    @Test
    void rejectsMissingInvalidAndGuestTokensBeforeAccessingData() throws Exception {
        mvc.perform(get(ROUTE).param("format", "pdf")).andExpect(status().isForbidden());
        mvc.perform(get(ROUTE).param("format", "pdf").header(HttpHeaders.AUTHORIZATION, "Bearer malformed"))
                .andExpect(status().isUnauthorized());
        String guest = jwtService.generateGuestToken(UUID.randomUUID(), MEETING_ID,
                Date.from(Instant.now().plusSeconds(120)));
        mvc.perform(get(ROUTE).param("format", "csv").header(HttpHeaders.AUTHORIZATION, "Bearer " + guest))
                .andExpect(status().isForbidden());
        verifyNoInteractions(users, meetings, audits, jobs, summaries, items);
    }

    @Test
    void rejectsMissingMeetingAndAnotherWorkspaceBeforeReadingReviewData() throws Exception {
        seedMeeting("Họp nội bộ");
        authenticate(UUID.randomUUID());
        request(ROUTE, "csv").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEETING_ACCESS_DENIED"));
        request("/meetings/" + UUID.randomUUID() + "/export", "pdf").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MEETING_NOT_FOUND"));
        verifyNoInteractions(audits, jobs, summaries, items);
    }

    @Test
    void rejectsMissingReviewEvidenceMissingSummaryAndEmptySummary() throws Exception {
        seedMeeting("Họp nội bộ");
        request(ROUTE, "csv").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MEETING_EXPORT_REVIEW_NOT_CONFIRMED"));
        seedReview(" \t", List.of(), List.of());
        request(ROUTE, "csv").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MEETING_EXPORT_SUMMARY_EMPTY"));
        when(summaries.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(Optional.empty());
        request(ROUTE, "pdf").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MEETING_EXPORT_SUMMARY_NOT_FOUND"));
    }

    @Test
    void returnsJsonErrorWithoutAttachmentWhenPdfGenerationFails() throws Exception {
        seedMeeting("Họp nhóm");
        seedReview("Kết quả đã lưu", List.of(), List.of());
        try (var font = mockStatic(PDType0Font.class)) {
            font.when(() -> PDType0Font.load(any(PDDocument.class), any(InputStream.class)))
                    .thenThrow(new IOException("Test font loading failure"));
            request(ROUTE, "pdf").andExpect(status().isInternalServerError())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(header().doesNotExist(HttpHeaders.CONTENT_DISPOSITION))
                    .andExpect(jsonPath("$.code").value("MEETING_EXPORT_FAILED"))
                    .andExpect(jsonPath("$.detail").isEmpty());
        }
    }

    private byte[] downloaded(String format, String mediaType) throws Exception {
        var response = request(ROUTE, format)
                .andExpect(status().isOk())
                .andExpect(content().contentType(mediaType))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"meeting-report-" + MEETING_ID + "." + format.toLowerCase() + "\""))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andReturn().getResponse();
        byte[] body = response.getContentAsByteArray();
        assertThat(response.getHeader(HttpHeaders.CONTENT_LENGTH)).isEqualTo(Integer.toString(body.length));
        assertThat(body).isNotEmpty();
        return body;
    }

    private ResultActions request(String route, String format) throws Exception {
        return mvc.perform(get(route).param("format", format).header(HttpHeaders.AUTHORIZATION, bearerToken())
                .accept(MediaType.ALL));
    }

    private void authenticate(UUID userId) {
        when(users.findByEmail(EMAIL)).thenReturn(Optional.of(User.builder().id(userId).email(EMAIL).build()));
    }

    private String bearerToken() {
        return "Bearer " + Jwts.builder().setSubject(EMAIL).claim("tokenVersion", 0)
                .setExpiration(Date.from(Instant.now().plusSeconds(120)))
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8))).compact();
    }

    private void seedMeeting(String title) {
        authenticate(WORKSPACE_ID);
        // Job hiện hành khác job đã review để kiểm tra API chọn phiên bản theo audit.
        when(meetings.findById(MEETING_ID)).thenReturn(Optional.of(Meeting.builder()
                .id(MEETING_ID).workspace_id(WORKSPACE_ID).media_file_id(UUID.randomUUID()).title(title)
                .created_at(CREATED_AT).active_job_id(ACTIVE_JOB_ID).build()));
    }

    private void seedReview(String text, List<ActionItem> tasks, List<MeetingAuditLog> taskChanges) {
        var summary = new Summary();
        summary.setId(SUMMARY_ID);
        summary.setMeetingId(MEETING_ID);
        summary.setProcessingJobId(REVIEWED_JOB_ID);
        summary.setExecutiveSummary(text);
        var summaryChange = audit("SUMMARY", SUMMARY_ID, "executiveSummary", text);
        var changes = new ArrayList<>(taskChanges);
        changes.add(summaryChange);
        when(audits.findFirstByMeetingIdAndEventTypeAndJobIdIsNotNullOrderByCreatedAtDesc(MEETING_ID, REVIEW_EVENT))
                .thenReturn(Optional.of(summaryChange));
        when(audits.findByMeetingIdAndJobIdAndEventTypeOrderByCreatedAtDesc(MEETING_ID, REVIEWED_JOB_ID, REVIEW_EVENT))
                .thenReturn(changes);
        when(jobs.findById(REVIEWED_JOB_ID)).thenReturn(Optional.of(Job.builder()
                .id(REVIEWED_JOB_ID).meetingId(MEETING_ID).status(JobStatus.COMPLETED).build()));
        when(summaries.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(Optional.of(summary));
        when(items.findByProcessingJobId(REVIEWED_JOB_ID)).thenReturn(tasks);
    }

    private ActionItem task(long id, String title) {
        var item = new ActionItem();
        item.setId(new UUID(0, id));
        item.setMeetingId(MEETING_ID);
        item.setProcessingJobId(REVIEWED_JOB_ID);
        item.setTaskName(title);
        item.setStatus("OPEN");
        return item;
    }

    private MeetingAuditLog audit(String entity, UUID id, String field, String value) {
        var change = new MeetingAuditLog();
        change.setMeetingId(MEETING_ID);
        change.setJobId(REVIEWED_JOB_ID);
        change.setEntityType(entity);
        change.setEntityId(id);
        change.setFieldName(field);
        change.setNewValue(value);
        return change;
    }
}
