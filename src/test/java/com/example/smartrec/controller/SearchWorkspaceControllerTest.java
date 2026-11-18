package com.example.smartrec.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.WorkspaceSearchHitDTO;
import com.example.smartrec.exception.GlobalExceptionHandler;
import com.example.smartrec.service.WorkspaceSearchService;

/**
 * Kiểm thử MVC độc lập cho route, bind query parameter, JSON response và exception handler chung.
 * Logic service và truy vấn PostgreSQL được kiểm tra ở các test suite riêng.
 */
@ExtendWith(MockitoExtension.class)
class SearchWorkspaceControllerTest {
    private static final UUID MEETING_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID SPEAKER_ID = UUID.fromString("40000000-0000-0000-0000-000000000001");
    private static final UUID SOURCE_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");

    @Mock
    private WorkspaceSearchService workspaceSearchService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(
                new SearchWorkspaceController(workspaceSearchService))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void bindsRouteAndSearchParametersAndReturnsProjectPageResponse() throws Exception {
        WorkspaceSearchHitDTO hit = new WorkspaceSearchHitDTO(
                SOURCE_ID, "Discussed Spring Boot", 12_500L, SPEAKER_ID, "Lan", "SPEAKER_1");
        when(workspaceSearchService.searchMeetingTranscript(MEETING_ID, "Spring Boot", SPEAKER_ID, 2, 5))
                .thenReturn(new PageResponse<>(List.of(hit), 2, 5, 11, 3));

        mockMvc.perform(get("/meetings/{id}/search", MEETING_ID)
                        .param("q", "Spring Boot")
                        .param("speakerId", SPEAKER_ID.toString())
                        .param("page", "2")
                        .param("size", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(2))
                .andExpect(jsonPath("$.size").value(5))
                .andExpect(jsonPath("$.totalElements").value(11))
                .andExpect(jsonPath("$.totalPages").value(3))
                .andExpect(jsonPath("$.content[0].sourceId").value(SOURCE_ID.toString()))
                .andExpect(jsonPath("$.content[0].snippet").value("Discussed Spring Boot"))
                .andExpect(jsonPath("$.content[0].startTimeMs").value(12_500))
                .andExpect(jsonPath("$.content[0].speakerId").value(SPEAKER_ID.toString()))
                .andExpect(jsonPath("$.content[0].speakerName").value("Lan"))
                .andExpect(jsonPath("$.content[0].speakerLabel").value("SPEAKER_1"));

        verify(workspaceSearchService).searchMeetingTranscript(
                eq(MEETING_ID), eq("Spring Boot"), eq(SPEAKER_ID), eq(2), eq(5));
    }

    @Test
    void appliesProjectPaginationDefaultsWhenParametersAreOmitted() throws Exception {
        when(workspaceSearchService.searchMeetingTranscript(MEETING_ID, "term", null, 0, 20))
                .thenReturn(new PageResponse<>(List.of(), 0, 20, 0, 0));

        mockMvc.perform(get("/meetings/{id}/search", MEETING_ID).param("q", "term"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.content").isEmpty());

        verify(workspaceSearchService).searchMeetingTranscript(
                eq(MEETING_ID), eq("term"), eq(null), eq(0), eq(20));
    }

    @Test
    void rejectsInvalidMeetingIdUsingTheProjectValidationError() throws Exception {
        mockMvc.perform(get("/meetings/not-a-uuid/search").param("q", "term"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER_FORMAT"));

        verifyNoInteractions(workspaceSearchService);
    }

    @Test
    void rejectsMissingQueryUsingTheProjectMissingParameterError() throws Exception {
        mockMvc.perform(get("/meetings/{id}/search", MEETING_ID))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MISSING_PARAMETER"));

        verifyNoInteractions(workspaceSearchService);
    }
}
