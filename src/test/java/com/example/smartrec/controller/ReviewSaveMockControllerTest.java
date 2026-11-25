package com.example.smartrec.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.context.WebApplicationContext;

import com.example.smartrec.config.SecurityConfig;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.GlobalExceptionHandler;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.repository.*;
import com.example.smartrec.security.JwtAuthenticationFilter;
import com.example.smartrec.security.JwtService;
import com.example.smartrec.service.JobService;
import com.example.smartrec.service.MeetingService;
import com.example.smartrec.service.MinioService;
import com.example.smartrec.service.impl.MeetingServiceImpl;
import com.example.smartrec.service.impl.ReviewSavePreviewServiceImpl;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

@SpringJUnitWebConfig(ReviewSaveMockControllerTest.Config.class)
@TestPropertySource(properties = {"smartrec.mock.review-save=true", "app.cors.allowed-origins=http://localhost:5173"})
class ReviewSaveMockControllerTest {
    private static final String KEY = UUID.randomUUID().toString();
    private static final String OWNER = "owner@example.invalid";
    private static final ObjectMapper JSON = new ObjectMapper();

    @TestConfiguration
    @EnableAutoConfiguration(exclude = {DataSourceAutoConfiguration.class, RedisAutoConfiguration.class})
    @Import({ReviewSaveMockController.class, ReviewSavePreviewServiceImpl.class, SecurityConfig.class,
            GlobalExceptionHandler.class})
    static class Config {
        @Bean JobService jobs() { return mock(JobService.class); }
        @Bean UserRepository users() { return mock(UserRepository.class); }
        @Bean MeetingRepository meetings() { return mock(MeetingRepository.class); }
        @Bean ActionItemRepository items() { return mock(ActionItemRepository.class); }
        @Bean MeetingService meetingService(MeetingRepository meetings, UserRepository users) {
            return new MeetingServiceImpl(meetings, mock(FolderRepository.class), mock(MediaFileRepository.class),
                    users, mock(MinioService.class));
        }
        @Bean JwtAuthenticationFilter jwt(UserRepository users) {
            return new JwtAuthenticationFilter(new JwtService(KEY), users);
        }
    }

    @Autowired WebApplicationContext context;
    @Autowired UserRepository users;
    @Autowired MeetingRepository meetings;
    @Autowired JobService jobs;
    @Autowired ActionItemRepository items;
    MockMvc mvc;
    ObjectNode draft;
    UUID meetingId, jobId;
    Set<UUID> taskIds;
    String bearer;

    @BeforeEach void setUp() throws Exception {
        mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity()).build();
        draft = (ObjectNode) JSON.readTree(ReviewSaveMockController.SAMPLE_REQUEST);
        meetingId = UUID.fromString(draft.path("meetingId").asText());
        jobId = UUID.fromString(draft.path("jobId").asText());
        taskIds = Set.of(UUID.fromString(draft.at("/actionItems/0/id").asText()),
                UUID.fromString(draft.at("/actionItems/1/id").asText()));
        reset(users, meetings, jobs, items);
        User owner = User.builder().id(UUID.randomUUID()).email(OWNER).token_version(0L).build();
        when(users.findByEmail(OWNER)).thenReturn(Optional.of(owner));
        when(meetings.findById(meetingId)).thenReturn(Optional.of(Meeting.builder().id(meetingId)
                .workspace_id(owner.getId()).media_file_id(UUID.randomUUID()).build()));
        when(jobs.getJobForCurrentUser(jobId)).thenReturn(JobResponse.builder().meetingId(meetingId).build());
        when(items.countByMeetingIdAndProcessingJobIdAndIdIn(meetingId, jobId, taskIds)).thenReturn(2L);
        bearer = "Bearer " + Jwts.builder().setSubject(OWNER)
                .signWith(Keys.hmacShaKeyFor(KEY.getBytes(StandardCharsets.UTF_8))).compact();
    }

    private org.springframework.test.web.servlet.ResultActions submit(String body, String auth) throws Exception {
        var request = post("/api/v1/review-save").contextPath("/api/v1")
                .contentType(MediaType.APPLICATION_JSON).content(body);
        if (auth != null) request.header("Authorization", auth);
        return mvc.perform(request);
    }

    @Test void openApiRequestExampleProducesDocumentedPreview() throws Exception {
        JsonNode spec = JSON.readTree(mvc.perform(get("/api/v1/v3/api-docs").contextPath("/api/v1").header("Authorization", bearer))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
        JsonNode operation = spec.at("/paths/~1review-save/post");
        JsonNode example = operation.at("/requestBody/content/application~1json/examples/Synthetic review request/value");
        JsonNode response = operation.at("/responses/200/content/application~1json/examples/Synthetic preview response/value");
        assertThat(example).isEqualTo(draft);
        assertThat(response.path("mock").asBoolean()).isTrue();
        assertThat(response.path("exportPreview")).isEqualTo(draft);
        submit(example.toString(), bearer).andExpect(status().isOk()).andExpect(content().json(response.toString(), true));
    }

    @Test void permitsEmptyTaskListAndRepeatedPreviewWithoutPersistence() throws Exception {
        draft.putArray("actionItems");
        for (int attempt = 0; attempt < 2; attempt++) {
            submit(draft.toString(), bearer).andExpect(status().isOk())
                    .andExpect(jsonPath("$.mock").value(true)).andExpect(jsonPath("$.exportPreview.actionItems").isEmpty());
        }
        verifyNoInteractions(items);
    }

    @ParameterizedTest
    @ValueSource(strings = {"meetingId", "jobId", "summary", "actionItems"})
    void rejectsMissingRequiredFields(String field) throws Exception {
        draft.remove(field);
        invalid(draft.toString());
    }

    @Test void rejectsInvalidTextDateIdsAndTaskDuplicates() throws Exception {
        ((ObjectNode) draft.at("/actionItems/0")).put("title", " ");
        invalid(draft.toString());
        ((ObjectNode) draft.at("/actionItems/0")).put("title", 12);
        invalid(draft.toString());
        ((ObjectNode) draft.at("/actionItems/0")).put("title", "Task").put("assigneeName", "x".repeat(256));
        invalid(draft.toString());
        ((ObjectNode) draft.at("/actionItems/0")).put("dueDate", "2026-02-30T10:00:00Z");
        invalid(draft.toString());
        ((ObjectNode) draft.at("/actionItems/0")).put("dueDate", "2026-11-27");
        invalid(draft.toString());
        draft.put("meetingId", "bad-id");
        invalid(draft.toString());
        draft = (ObjectNode) JSON.readTree(ReviewSaveMockController.SAMPLE_REQUEST);
        ((ArrayNode) draft.get("actionItems")).add(draft.at("/actionItems/0").deepCopy());
        invalid(draft.toString());
    }

    @Test void malformedJsonUsesExistingValidationErrorFormat() throws Exception {
        submit("{", bearer).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.detail").isArray());
    }

    private void invalid(String body) throws Exception {
        submit(body, bearer).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test void rejectsMissingInvalidAndGuestTokens() throws Exception {
        submit(draft.toString(), null).andExpect(status().isForbidden());
        submit(draft.toString(), "Bearer invalid").andExpect(status().isUnauthorized());
        String guest = new JwtService(KEY).generateGuestToken(UUID.randomUUID(), meetingId, new Date(System.currentTimeMillis() + 60_000));
        submit(draft.toString(), "Bearer " + guest).andExpect(status().isForbidden());
        verifyNoInteractions(meetings, jobs, items);
    }

    @Test void usesAuthenticatedOwnerAndRejectsMissingMeeting() throws Exception {
        when(meetings.findById(meetingId)).thenReturn(Optional.of(Meeting.builder().workspace_id(UUID.randomUUID()).build()));
        draft.put("userId", UUID.randomUUID().toString());
        submit(draft.toString(), bearer).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("MEETING_ACCESS_DENIED"));
        when(meetings.findById(meetingId)).thenReturn(Optional.empty());
        submit(draft.toString(), bearer).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("MEETING_NOT_FOUND"));
    }

    @Test void rejectsMismatchedJobAndTask() throws Exception {
        when(jobs.getJobForCurrentUser(jobId)).thenReturn(JobResponse.builder().meetingId(UUID.randomUUID()).build());
        submit(draft.toString(), bearer).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("MEETING_JOB_NOT_FOUND"));
        when(jobs.getJobForCurrentUser(jobId)).thenReturn(JobResponse.builder().meetingId(meetingId).build());
        when(items.countByMeetingIdAndProcessingJobIdAndIdIn(meetingId, jobId, taskIds)).thenReturn(1L);
        submit(draft.toString(), bearer).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("MEETING_RESULT_SCOPE_MISMATCH"));
    }

    @Test void controllerIsDisabledWithoutOptIn() {
        new ApplicationContextRunner().withUserConfiguration(ReviewSaveMockController.class)
                .run(app -> assertThat(app).hasNotFailed().doesNotHaveBean(ReviewSaveMockController.class));
    }
}
