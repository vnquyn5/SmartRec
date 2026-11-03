package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import com.example.smartrec.model.dto.AiUsageRequest;
import com.example.smartrec.service.AiUsageIngestionService;

@ExtendWith(MockitoExtension.class)
class AiUsageControllerTest {
    @Mock private AiUsageIngestionService ingestionService;

    private AiUsageController controller;
    private AiUsageRequest request;

    @BeforeEach
    void setUp() {
        controller = new AiUsageController(ingestionService);
        ReflectionTestUtils.setField(controller, "configuredInternalToken", "test-internal-token");
        request = new AiUsageRequest();
        request.setRequestId(UUID.randomUUID());
        request.setJobId(UUID.randomUUID());
    }

    @Test
    void missingTokenIsUnauthorizedAndDoesNotReachService() {
        assertEquals(HttpStatus.UNAUTHORIZED, controller.record(null, request).getStatusCode());
        verify(ingestionService, never()).record(request);
    }

    @Test
    void wrongTokenIsUnauthorizedAndDoesNotReachService() {
        assertEquals(HttpStatus.UNAUTHORIZED, controller.record("wrong-token", request).getStatusCode());
        verify(ingestionService, never()).record(request);
    }

    @Test
    void validTokenReturnsNoContent() {
        when(ingestionService.record(request)).thenReturn(true);
        assertEquals(HttpStatus.NO_CONTENT,
                controller.record("test-internal-token", request).getStatusCode());
        verify(ingestionService).record(request);
    }
}
