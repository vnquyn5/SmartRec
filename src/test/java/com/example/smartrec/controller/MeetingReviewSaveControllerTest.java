package com.example.smartrec.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.example.smartrec.config.SecurityConfig;
import com.example.smartrec.entity.User;
import com.example.smartrec.model.dto.MeetingReviewSaveRequest;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.repository.PublicShareLinkRepository;
import com.example.smartrec.repository.SummaryRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.security.JwtService;
import com.example.smartrec.service.MeetingAuditLogService;
import com.example.smartrec.service.MeetingProcessingService;
import com.example.smartrec.service.MeetingService;
import com.example.smartrec.service.MeetingSpeakerService;
import com.example.smartrec.service.impl.MeetingReviewServiceImpl;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.persistence.EntityManager;

@WebMvcTest(controllers = MeetingController.class, properties = {
        "app.cors.allowed-origins=http://localhost:5173",
        "jwt.secret=review-mockmvc-testing-signing-key"
})
@Import({SecurityConfig.class, JwtService.class, MeetingReviewServiceImpl.class})
class MeetingReviewSaveControllerTest {
    private static final String KEY = "review-mockmvc-testing-signing-key";
    private static final String OWNER = "reviewer@example.invalid";
    private static final UUID MEETING = UUID.randomUUID();
    private static final UUID JOB = UUID.randomUUID();
    private static final UUID TASK = UUID.randomUUID();
    private static final String URL = "/api/v1/meetings/" + MEETING + "/review-save";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @MockBean UserRepository users;
    @MockBean PublicShareLinkRepository shareLinks;
    @SpyBean MeetingReviewServiceImpl review;
    @MockBean MeetingAuditLogService audit;
    @MockBean SummaryRepository summaries;
    @MockBean ActionItemRepository actionItems;
    @MockBean EntityManager entityManager;
    @MockBean MeetingService meetings;
    @MockBean MeetingSpeakerService speakers;
    @MockBean MeetingProcessingService processing;

    private String bearer;

    @BeforeEach
    void authenticate() {
        when(users.findByEmail(OWNER)).thenReturn(Optional.of(User.builder().email(OWNER).token_version(0L).build()));
        bearer = "Bearer " + Jwts.builder().setSubject(OWNER)
                .signWith(Keys.hmacShaKeyFor(KEY.getBytes(StandardCharsets.UTF_8))).compact();
    }

    @Test
    void bindsPathAndDistinguishesOmittedFieldsFromExplicitNull() throws Exception {
        submit(body(", \"dueDate\": \"2026-11-27T17:00:00+07:00\", \"deadlineRaw\": null"), bearer)
                .andExpect(status().isNoContent()).andExpect(content().string(""));

        var request = ArgumentCaptor.forClass(MeetingReviewSaveRequest.class);
        verify(review).saveReview(eq(MEETING), request.capture());
        assertThat(request.getValue().getJobId()).isEqualTo(JOB);
        var task = request.getValue().getActionItems().get(0);
        assertThat(task.getId()).isEqualTo(TASK);
        assertThat(task.getAssigneeName()).isNull();
        assertThat(task.getDeadlineRaw().isNull()).isTrue();
        assertThat(task.getDueDate().textValue()).isEqualTo("2026-11-27T17:00:00+07:00");
    }

    @Test
    void rejectsMissingInvalidAndGuestTokensBeforeCallingService() throws Exception {
        submit(body(""), null).andExpect(status().isForbidden());
        submit(body(""), "Bearer invalid").andExpect(status().isUnauthorized());
        var guest = jwtService.generateGuestToken(UUID.randomUUID(), MEETING, new Date(System.currentTimeMillis() + 60_000));
        submit(body(""), "Bearer " + guest).andExpect(status().isForbidden());
        verifyNoInteractions(review);
    }

    @Test
    void rejectsUnknownRootAndSummaryFieldsAndInvalidPath() throws Exception {
        String valid = body("");
        invalid(valid.replace("\"summary\":", "\"speaker\": [], \"summary\":"));
        invalid(valid.replace("\"summary\": {", "\"summary\": {\"details\": {}, "));
        invalid(valid.replace("\"actionItems\":", "\"transcripts\": [], \"actionItems\":"));
        invalid(valid.replace("\"actionItems\":", "\"meetingId\": null, \"actionItems\":"));
        mvc.perform(post(URL.replace(MEETING.toString(), "invalid-id")).contextPath("/api/v1")
                .header("Authorization", bearer).contentType(MediaType.APPLICATION_JSON).content(valid))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_PARAMETER_FORMAT"));
        verifyNoInteractions(review);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            ", \"verified\": true", ", \"assigneeNameProvided\": true", ", \"title\": null", ", \"assigneeName\": 42",
            ", \"deadlineRaw\": false", ", \"dueDate\": \"2026-11-27\"", ", \"dueDate\": 123"
    })
    void rejectsUnknownTaskFieldsAndInvalidValues(String fields) throws Exception {
        invalid(body(fields));
        verifyNoInteractions(audit);
    }

    @Test
    void validatesRequiredFieldsAndDoesNotEchoPersistenceDetails() throws Exception {
        invalid(body("").replace("Review summary", " "));
        invalid(body("").replace("Review task", " "));
        invalid(body("").replace(JOB.toString(), "unknown-job"));
        verifyNoInteractions(review);

        doThrow(new IllegalStateException("database diagnostic")).when(review).saveReview(eq(MEETING), any());
        submit(body(""), bearer).andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_SERVER_ERROR"))
                .andExpect(jsonPath("$.detail").isEmpty());
    }

    @Test
    void rejectsAnOverlengthAssigneeNameBeforeAudit() throws Exception {
        invalid(body(", \"assigneeName\": \"" + "a".repeat(256) + "\""));
        verifyNoInteractions(audit);
    }

    private void invalid(String body) throws Exception {
        submit(body, bearer).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    private ResultActions submit(String body, String auth) throws Exception {
        var request = post(URL).contextPath("/api/v1").contentType(MediaType.APPLICATION_JSON).content(body);
        if (auth != null) {
            request.header("Authorization", auth);
        }
        return mvc.perform(request);
    }

    private static String body(String taskFields) {
        return """
                {"jobId": "%s", "summary": {"executiveSummary": "Review summary"},
                 "actionItems": [{"id": "%s", "title": "Review task"%s}]}
                """.formatted(JOB, TASK, taskFields);
    }
}
