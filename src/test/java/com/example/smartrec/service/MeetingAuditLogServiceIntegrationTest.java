package com.example.smartrec.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.junit.jupiter.api.Assertions.fail;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.example.smartrec.entity.ActionItem;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingAuditLog;
import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.Summary;
import com.example.smartrec.entity.User;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.MeetingReviewSaveRequest;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.service.impl.MeetingAuditLogServiceImpl;
import com.example.smartrec.service.impl.MeetingReportExportServiceImpl;
import com.example.smartrec.service.impl.MeetingReviewServiceImpl;
import com.example.smartrec.service.impl.MeetingServiceImpl;
import com.example.smartrec.service.impl.ReviewedMeetingReportReader;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

import jakarta.persistence.EntityManager;

@DataJpaTest(showSql = false, properties = {
        "spring.sql.init.mode=never",
        "spring.jpa.hibernate.ddl-auto=${smartrec.audit.test.ddl-auto:none}",
        "logging.level.root=WARN",
        "logging.level.org.hibernate.SQL=OFF",
        "logging.level.org.hibernate.orm.jdbc.bind=OFF"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@EnabledIfSystemProperty(named = "smartrec.integration", matches = "true")
@Import({MeetingAuditLogServiceImpl.class, MeetingServiceImpl.class, MeetingReviewServiceImpl.class,
        MeetingReportExportServiceImpl.class, ReviewedMeetingReportReader.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class MeetingAuditLogServiceIntegrationTest {
    private static final Instant AI_DUE_DATE = Instant.parse("2026-11-27T10:00:00Z");
    private static final String AI_SUMMARY = "AI summary";
    private static final String REVIEWED_SUMMARY = "Reviewed summary";
    private static final String REVIEWED_TITLE = "Reviewed title";
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired MeetingAuditLogService service;
    @Autowired MeetingReviewService review;
    @Autowired MeetingReportExportService reportExport;
    @Autowired SummaryRepository summaries;
    @Autowired ActionItemRepository actionItems;
    @Autowired EntityManager entities;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;
    @MockBean MinioService minioService;

    private TransactionTemplate tx;
    private Scope owner;
    private Scope outsider;

    @BeforeEach
    void seedDatabase() {
        tx = new TransactionTemplate(transactions);
        owner = tx.execute(status -> createScope());
        authenticate(owner.email(), List.of());
    }

    @AfterEach
    void removeFixtures() {
        SecurityContextHolder.clearContext();
        if (owner != null) {
            deleteScope(owner);
        }
        if (outsider != null) {
            deleteScope(outsider);
        }
    }

    @Test
    void commitsFieldChangesAndSkipsUnchangedValuesAndRepeatedSaves() {
        Instant started = Instant.now();
        for (int attempt = 0; attempt < 2; attempt++) {
            tx.executeWithoutResult(status -> service.auditReviewSave(
                    owner.meetingId(), owner.jobId(), Set.of(owner.itemId()), () -> {
                        summary().setExecutiveSummary(REVIEWED_SUMMARY);
                        ActionItem item = actionItem();
                        item.setAssigneeName("Reviewer assigned");
                        item.setDueDate(AI_DUE_DATE.plusNanos(100));
                        item.setDeadlineRaw(null);
                        item.setVerified(true);
                    }));
        }

        assertThat(audits()).extracting(MeetingAuditLog::getEntityType, MeetingAuditLog::getEntityId,
                MeetingAuditLog::getFieldName, MeetingAuditLog::getOldValue, MeetingAuditLog::getNewValue)
                .containsExactlyInAnyOrder(
                        tuple("SUMMARY", owner.summaryId(), "executiveSummary", AI_SUMMARY, REVIEWED_SUMMARY),
                        tuple("ACTION_ITEM", owner.itemId(), "assigneeName", null, "Reviewer assigned"),
                        tuple("ACTION_ITEM", owner.itemId(), "deadlineRaw", "Friday", null));
        assertThat(audits()).allSatisfy(row -> {
            assertThat(row.getId()).isNotNull();
            assertThat(row.getMeetingId()).isEqualTo(owner.meetingId());
            assertThat(row.getJobId()).isEqualTo(owner.jobId());
            assertThat(row.getActorId()).isEqualTo(owner.actorId());
            assertThat(row.getEventType()).isEqualTo("HUMAN_REVIEW_SAVE");
            assertThat(row.getCreatedAt()).isBetween(started.minusMillis(1), Instant.now());
        });
        assertThat(summary().getExecutiveSummary()).isEqualTo(REVIEWED_SUMMARY);
        assertThat(summary().getRawLlmResponse().path("executiveSummary").asText()).isEqualTo(AI_SUMMARY);
        assertThat(actionItem().getAssigneeName()).isEqualTo("Reviewer assigned");
    }

    @Test
    void reviewCommitsChangesOnceAndDistinguishesOmittedValuesFromNull() throws Exception {
        ObjectNode draft = reviewDraft();
        task(draft).put("assigneeName", "Reviewer assigned").putNull("deadlineRaw");
        saveReview(draft);
        saveReview(draft);

        assertThat(summary().getExecutiveSummary()).isEqualTo(REVIEWED_SUMMARY);
        assertThat(summary().getRawLlmResponse().path("executiveSummary").asText()).isEqualTo(AI_SUMMARY);
        assertThat(actionItem()).satisfies(item -> {
            assertThat(item.getTaskName()).isEqualTo(REVIEWED_TITLE);
            assertThat(item.getAssigneeName()).isEqualTo("Reviewer assigned");
            assertThat(item.getDueDate()).isEqualTo(AI_DUE_DATE);
            assertThat(item.getDeadlineRaw()).isNull();
            assertThat(item.getStatus()).isEqualTo("OPEN");
            assertThat(item.isVerified()).isFalse();
        });
        assertThat(actionItems.findByProcessingJobId(owner.jobId())).hasSize(1);
        assertThat(audits()).extracting(MeetingAuditLog::getFieldName, MeetingAuditLog::getOldValue,
                MeetingAuditLog::getNewValue).containsExactlyInAnyOrder(
                        tuple("executiveSummary", AI_SUMMARY, REVIEWED_SUMMARY),
                        tuple("title", "AI title", REVIEWED_TITLE),
                        tuple("assigneeName", null, "Reviewer assigned"),
                        tuple("deadlineRaw", "Friday", null));
        assertThat(audits()).allSatisfy(row -> {
            assertThat(row.getActorId()).isEqualTo(owner.actorId());
            assertThat(row.getMeetingId()).isEqualTo(owner.meetingId());
            assertThat(row.getJobId()).isEqualTo(owner.jobId());
            assertThat(row.getEventType()).isEqualTo("HUMAN_REVIEW_SAVE");
        });

        task(draft).remove("deadlineRaw");
        task(draft).put("dueDate", "2026-11-29T17:00:00+07:00");
        saveReview(draft);
        assertThat(actionItem().getDueDate()).isEqualTo(Instant.parse("2026-11-29T10:00:00Z"));

        task(draft).putNull("dueDate");
        task(draft).putNull("assigneeName");
        saveReview(draft);
        assertThat(actionItem().getDueDate()).isNull();
        assertThat(actionItem().getAssigneeName()).isNull();
        assertThat(audits()).hasSize(7).extracting(MeetingAuditLog::getFieldName,
                MeetingAuditLog::getOldValue, MeetingAuditLog::getNewValue).contains(
                        tuple("dueDate", "2026-11-29T10:00:00Z", null),
                        tuple("assigneeName", "Reviewer assigned", null));
    }

    @Test
    void exportsTheCommittedReviewFromPostgres() throws Exception {
        ObjectNode draft = reviewDraft();
        draft.withObject("/summary").put("executiveSummary", "Đã chốt kế hoạch");
        task(draft).put("title", "Gửi tài liệu").put("assigneeName", "Nguyễn An")
                .put("dueDate", "2026-11-29T17:00:00+07:00");
        // Review Save commit trước khi export đọc lại Summary, Action Items và audit từ PostgreSQL.
        saveReview(draft);

        var download = reportExport.exportReport(owner.meetingId(), "csv");
        try (var stream = download.inputStream()) {
            assertThat(new String(stream.readAllBytes(), StandardCharsets.UTF_8))
                    .contains("Đã chốt kế hoạch", "Gửi tài liệu", "Nguyễn An", "2026-11-29T10:00:00Z")
                    .doesNotContain(AI_SUMMARY, "AI title", "Friday");
        }
    }

    @Test
    void reviewReplayAfterANewerEditAppliesAgainstTheCurrentValues() throws Exception {
        ObjectNode first = reviewDraft();
        ObjectNode second = first.deepCopy();
        task(second).put("title", "Second edit");
        saveReview(first);
        saveReview(second);
        saveReview(first);

        assertThat(actionItem().getTaskName()).isEqualTo(REVIEWED_TITLE);
        assertThat(audits()).extracting(MeetingAuditLog::getOldValue, MeetingAuditLog::getNewValue)
                .contains(tuple("Second edit", REVIEWED_TITLE));
    }

    @Test
    void concurrentIdenticalReviewsWriteOneAuditPerChangedField() throws Exception {
        var request = reviewRequest(reviewDraft());
        var start = new CountDownLatch(2);
        var workers = Executors.newFixedThreadPool(2);
        try {
            var attempts = workers.invokeAll(List.of(
                    () -> reviewConcurrently(request, start),
                    () -> reviewConcurrently(request, start)), 10, TimeUnit.SECONDS);
            for (var attempt : attempts) {
                attempt.get();
            }
        } finally {
            workers.shutdownNow();
        }
        assertThat(audits()).extracting(MeetingAuditLog::getFieldName)
                .containsExactlyInAnyOrder("executiveSummary", "title");
    }

    private Void reviewConcurrently(MeetingReviewSaveRequest request, CountDownLatch start) throws InterruptedException {
        authenticate(owner.email(), List.of());
        try {
            start.countDown();
            start.await();
            review.saveReview(owner.meetingId(), request);
            return null;
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @Test
    void reviewRejectsForeignWorkspaceAndRecordsAndDuplicateTasks() {
        outsider = tx.execute(status -> createScope());
        ObjectNode draft = reviewDraft();

        assertThatThrownBy(() -> review.saveReview(UUID.randomUUID(), reviewRequest(draft)))
                .isInstanceOfSatisfying(BusinessException.class,
                        error -> assertThat(error.getCode()).isEqualTo("MEETING_NOT_FOUND"));
        authenticate(outsider.email(), List.of());
        rejectReview("MEETING_ACCESS_DENIED", draft);
        authenticate(owner.email(), List.of());
        draft.put("jobId", outsider.jobId().toString());
        rejectReview("MEETING_JOB_NOT_FOUND", draft);
        draft.put("jobId", owner.jobId().toString());
        task(draft).put("id", outsider.itemId().toString());
        rejectReview("MEETING_RESULT_SCOPE_MISMATCH", draft);
        task(draft).put("id", UUID.randomUUID().toString());
        rejectReview("MEETING_RESULT_SCOPE_MISMATCH", draft);
        task(draft).put("id", owner.itemId().toString());
        draft.withArray("actionItems").add(task(draft).deepCopy());
        rejectReview("VALIDATION_ERROR", draft);

        assertThat(summary().getExecutiveSummary()).isEqualTo(AI_SUMMARY);
        assertThat(audits()).isEmpty();
    }

    @Test
    void reviewRequiresAnActiveCompletedJobAndExistingSummary() {
        ObjectNode draft = reviewDraft();
        tx.executeWithoutResult(status -> entities.find(Meeting.class, owner.meetingId()).setActive_job_id(null));
        rejectReview("MEETING_REVIEW_JOB_NOT_READY", draft);
        tx.executeWithoutResult(status -> {
            entities.find(Meeting.class, owner.meetingId()).setActive_job_id(owner.jobId());
            entities.find(Job.class, owner.jobId()).setStatus(JobStatus.PROCESSING);
        });
        rejectReview("MEETING_REVIEW_JOB_NOT_READY", draft);
        tx.executeWithoutResult(status -> entities.find(Job.class, owner.jobId()).setStatus(JobStatus.COMPLETED));
        summaries.deleteById(owner.summaryId());
        rejectReview("MEETING_SUMMARY_NOT_FOUND", draft);
        assertThat(audits()).isEmpty();
    }

    @Test
    void reviewRejectsRenamingAnAssigneeLinkedToAUser() {
        tx.executeWithoutResult(status -> actionItem().setAssigneeUserId(owner.actorId()));
        ObjectNode draft = reviewDraft();
        task(draft).put("assigneeName", "Different name");
        rejectReview("MEETING_REVIEW_ASSIGNEE_LINKED", draft);
        assertThat(actionItem().getTaskName()).isEqualTo("AI title");
        assertThat(summary().getExecutiveSummary()).isEqualTo(AI_SUMMARY);
        assertThat(audits()).isEmpty();
    }

    @Test
    void reviewCannotClearALinkedSpeakerButCanKeepTheExistingAssignee() throws Exception {
        UUID speakerId = UUID.randomUUID();
        tx.executeWithoutResult(status -> {
            entities.persist(Speaker.builder().id(speakerId).meetingId(owner.meetingId())
                    .aiLabel("SPEAKER_00").realName("Fixture speaker").build());
            ActionItem item = actionItem();
            item.setAssigneeSpeakerId(speakerId);
            item.setAssigneeName("Fixture speaker");
        });
        ObjectNode draft = reviewDraft();
        task(draft).putNull("assigneeName");
        rejectReview("MEETING_REVIEW_ASSIGNEE_LINKED", draft);
        assertThat(summary().getExecutiveSummary()).isEqualTo(AI_SUMMARY);
        assertThat(audits()).isEmpty();

        task(draft).put("assigneeName", "Fixture speaker");
        saveReview(draft);
        assertThat(actionItem().getAssigneeSpeakerId()).isEqualTo(speakerId);
        assertThat(actionItem().getAssigneeName()).isEqualTo("Fixture speaker");
        assertThat(audits()).extracting(MeetingAuditLog::getFieldName)
                .containsExactlyInAnyOrder("executiveSummary", "title");
    }

    @Test
    void reviewRollsBackWhenPersistenceOrAuditFails() throws Exception {
        var request = reviewRequest(reviewDraft());
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            jdbc.execute("alter table action_items add check (id is distinct from '" + owner.itemId()
                    + "'::uuid or task_name = 'AI title') not valid");
            review.saveReview(owner.meetingId(), request);
        })).isInstanceOf(DataIntegrityViolationException.class).hasStackTraceContaining("violates check constraint");
        assertThat(summary().getExecutiveSummary()).isEqualTo(AI_SUMMARY);
        assertThat(actionItem().getTaskName()).isEqualTo("AI title");
        assertThat(audits()).isEmpty();

        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            jdbc.execute("alter table meeting_audit_logs add check (actor_id is distinct from '"
                    + owner.actorId() + "'::uuid) not valid");
            review.saveReview(owner.meetingId(), request);
        })).isInstanceOf(DataIntegrityViolationException.class).hasStackTraceContaining("violates check constraint");
        assertThat(summary().getExecutiveSummary()).isEqualTo(AI_SUMMARY);
        assertThat(actionItem().getTaskName()).isEqualTo("AI title");
        assertThat(audits()).isEmpty();
    }

    private ObjectNode reviewDraft() {
        ObjectNode draft = JSON.createObjectNode();
        draft.put("jobId", owner.jobId().toString());
        draft.putObject("summary").put("executiveSummary", REVIEWED_SUMMARY);
        draft.putArray("actionItems").addObject().put("id", owner.itemId().toString()).put("title", REVIEWED_TITLE);
        return draft;
    }

    private static ObjectNode task(ObjectNode draft) {
        return (ObjectNode) draft.at("/actionItems/0");
    }

    private static MeetingReviewSaveRequest reviewRequest(ObjectNode draft) throws JsonProcessingException {
        return JSON.treeToValue(draft, MeetingReviewSaveRequest.class);
    }

    private void saveReview(ObjectNode draft) throws JsonProcessingException {
        review.saveReview(owner.meetingId(), reviewRequest(draft));
    }

    private void rejectReview(String code, ObjectNode draft) {
        assertThatThrownBy(() -> saveReview(draft)).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getCode()).isEqualTo(code));
    }

    @Test
    void auditsOneTimeChangeInUtc() {
        Instant accepted = Instant.parse("2026-11-30T08:15:00Z");
        tx.executeWithoutResult(status -> service.auditReviewSave(
                owner.meetingId(), owner.jobId(), Set.of(owner.itemId()), () -> {
                    actionItem().setDueDate(accepted);
                }));
        assertThat(audits()).singleElement().satisfies(row -> {
            assertThat(row.getFieldName()).isEqualTo("dueDate");
            assertThat(row.getOldValue()).isEqualTo(AI_DUE_DATE.toString());
            assertThat(row.getNewValue()).isEqualTo(accepted.toString());
        });
    }

    @Test
    void rejectsUnknownAndUnauthorizedActorsBeforeRunningTheSave() {
        outsider = tx.execute(status -> createScope());
        authenticate(outsider.email(), List.of());
        reject("MEETING_ACCESS_DENIED", owner.meetingId(), owner.jobId(), Set.of());
        authenticate("missing-" + owner.email(), List.of());
        reject("USER_NOT_FOUND", owner.meetingId(), owner.jobId(), Set.of());
        authenticate(owner.email(), List.of(new SimpleGrantedAuthority("ROLE_GUEST")));
        reject("MEETING_ACCESS_DENIED", owner.meetingId(), owner.jobId(), Set.of());
        SecurityContextHolder.clearContext();
        reject("UNAUTHORIZED", owner.meetingId(), owner.jobId(), Set.of());
        assertThat(audits()).isEmpty();
    }

    @Test
    void rejectsMissingOrUnrelatedTargetsBeforeRunningTheSave() {
        outsider = tx.execute(status -> createScope());
        reject("MEETING_NOT_FOUND", UUID.randomUUID(), owner.jobId(), Set.of());
        reject("MEETING_JOB_NOT_FOUND", owner.meetingId(), UUID.randomUUID(), Set.of());
        reject("MEETING_JOB_NOT_FOUND", owner.meetingId(), outsider.jobId(), Set.of());
        reject("MEETING_RESULT_SCOPE_MISMATCH", owner.meetingId(), owner.jobId(), Set.of(UUID.randomUUID()));
        reject("MEETING_RESULT_SCOPE_MISMATCH", owner.meetingId(), owner.jobId(), Set.of(outsider.itemId()));
        summaries.deleteById(owner.summaryId());
        reject("MEETING_SUMMARY_NOT_FOUND", owner.meetingId(), owner.jobId(), Set.of());
        assertThat(audits()).isEmpty();
    }

    @Test
    void requiresAnExistingWriteTransaction() {
        assertThatThrownBy(() -> service.auditReviewSave(owner.meetingId(), owner.jobId(), Set.of(),
                () -> fail("Review save must not run"))).isInstanceOf(IllegalTransactionStateException.class);
        TransactionTemplate readOnly = new TransactionTemplate(transactions);
        readOnly.setReadOnly(true);
        assertThatThrownBy(() -> readOnly.executeWithoutResult(status -> service.auditReviewSave(
                owner.meetingId(), owner.jobId(), Set.of(), () -> fail("Review save must not run"))))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    void rollsBackReviewWhenPostgresRejectsTheAuditInsert() {
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            // This constraint exists only inside the failing transaction and targets this fixture.
            jdbc.execute("alter table meeting_audit_logs add check (actor_id is distinct from '"
                    + owner.actorId() + "'::uuid) not valid");
            service.auditReviewSave(owner.meetingId(), owner.jobId(), Set.of(), () -> {
                summary().setExecutiveSummary(REVIEWED_SUMMARY);
            });
        })).isInstanceOf(DataIntegrityViolationException.class).hasStackTraceContaining("violates check constraint");
        assertThat(summary().getExecutiveSummary()).isEqualTo(AI_SUMMARY);
        assertThat(audits()).isEmpty();
    }

    @Test
    void refusesAnAuditWhenTheSaveRemovesTheSummary() {
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> service.auditReviewSave(
                owner.meetingId(), owner.jobId(), Set.of(), () -> {
                    summaries.deleteById(owner.summaryId());
                }))).isInstanceOfSatisfying(BusinessException.class,
                        error -> assertThat(error.getCode()).isEqualTo("MEETING_SUMMARY_NOT_FOUND"));
        assertThat(summary().getExecutiveSummary()).isEqualTo(AI_SUMMARY);
        assertThat(audits()).isEmpty();
    }

    @Test
    void rollsBackReviewWhenTheSaveCannotBeFlushed() {
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> service.auditReviewSave(
                owner.meetingId(), owner.jobId(), Set.of(owner.itemId()), () -> {
                    summary().setExecutiveSummary(REVIEWED_SUMMARY);
                    actionItem().setTaskName(null);
                }))).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(summary().getExecutiveSummary()).isEqualTo(AI_SUMMARY);
        assertThat(audits()).isEmpty();
    }

    @Test
    void rollsBackReviewAndAuditWhenTheOuterSaveFails() {
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            service.auditReviewSave(owner.meetingId(), owner.jobId(), Set.of(), () -> {
                summary().setExecutiveSummary(REVIEWED_SUMMARY);
            });
            entities.flush();
            assertThat(audits()).hasSize(1);
            jdbc.update("update action_items set task_name = null where id = ?", owner.itemId());
        })).isInstanceOf(DataIntegrityViolationException.class).hasStackTraceContaining("violates not-null constraint");
        assertThat(summary().getExecutiveSummary()).isEqualTo(AI_SUMMARY);
        assertThat(actionItem().getTaskName()).isEqualTo("AI title");
        assertThat(audits()).isEmpty();
    }

    private void reject(String expectedCode, UUID meetingId, UUID jobId, Set<UUID> ids) {
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> service.auditReviewSave(
                meetingId, jobId, ids, () -> fail("Review save must not run"))))
                .isInstanceOfSatisfying(BusinessException.class,
                        error -> assertThat(error.getCode()).isEqualTo(expectedCode));
    }

    private void authenticate(String email, List<SimpleGrantedAuthority> authorities) {
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(email, null, authorities));
    }

    private Summary summary() {
        return summaries.findById(owner.summaryId()).orElseThrow();
    }

    private ActionItem actionItem() {
        return actionItems.findById(owner.itemId()).orElseThrow();
    }

    private List<MeetingAuditLog> audits() {
        return entities.createQuery("from MeetingAuditLog where meetingId = :meetingId", MeetingAuditLog.class)
                .setParameter("meetingId", owner.meetingId()).getResultList();
    }

    private Scope createScope() {
        String email = UUID.randomUUID() + "@example.invalid";
        User actor = User.builder().email(email).full_name("Audit test user")
                .userCode(UUID.randomUUID().toString().substring(0, 24)).build();
        entities.persist(actor);
        MediaFile media = MediaFile.builder().original_name("fixture.wav").mime_type("audio/wav")
                .object_key(email).file_size_bytes(1L).workspace_id(actor.getId()).uploaded_by(actor.getId()).build();
        entities.persist(media);
        Meeting meeting = Meeting.builder().title("Audit test meeting").workspace_id(actor.getId())
                .media_file_id(media.getId()).build();
        entities.persist(meeting);
        Job job = Job.builder().mediaFileId(media.getId()).meetingId(meeting.getId())
                .status(JobStatus.COMPLETED).build();
        entities.persist(job);
        meeting.setActive_job_id(job.getId());

        Summary summary = new Summary();
        summary.setMeetingId(meeting.getId());
        summary.setProcessingJobId(job.getId());
        summary.setExecutiveSummary(AI_SUMMARY);
        summary.setRawLlmResponse(JsonNodeFactory.instance.objectNode().put("executiveSummary", AI_SUMMARY));
        entities.persist(summary);

        ActionItem item = new ActionItem();
        item.setMeetingId(meeting.getId());
        item.setProcessingJobId(job.getId());
        item.setTaskName("AI title");
        item.setStatus("OPEN");
        item.setDueDate(AI_DUE_DATE);
        item.setDeadlineRaw("Friday");
        entities.persist(item);
        return new Scope(actor.getId(), email, media.getId(), meeting.getId(), job.getId(),
                summary.getId(), item.getId());
    }

    private void deleteScope(Scope scope) {
        tx.executeWithoutResult(status -> {
            jdbc.update("delete from meeting_audit_logs where meeting_id = ?", scope.meetingId());
            jdbc.update("delete from action_items where id = ?", scope.itemId());
            jdbc.update("delete from meeting_summaries where id = ?", scope.summaryId());
            jdbc.update("delete from speakers where meeting_id = ?", scope.meetingId());
            jdbc.update("delete from processing_jobs where id = ?", scope.jobId());
            jdbc.update("delete from meetings where id = ?", scope.meetingId());
            jdbc.update("delete from media_file where id = ?", scope.mediaId());
            jdbc.update("delete from users where id = ?", scope.actorId());
        });
    }

    private record Scope(UUID actorId, String email, UUID mediaId, UUID meetingId,
            UUID jobId, UUID summaryId, UUID itemId) {}
}
