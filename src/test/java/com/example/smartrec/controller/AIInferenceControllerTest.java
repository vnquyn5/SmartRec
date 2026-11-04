package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.AIResponse;
import com.example.smartrec.service.impl.AIModelRouter;

@ExtendWith(MockitoExtension.class)
class AIInferenceControllerTest {
    @Mock
    private AIModelRouter modelRouter;
    @InjectMocks
    private AIInferenceController controller;

    @Test
    void internalTokenIsRequiredBeforeRouting() {
        ReflectionTestUtils.setField(controller, "configuredInternalToken", "test-token");

        BusinessException error = assertThrows(
                BusinessException.class,
                () -> controller.generateAIResult(UUID.randomUUID(), UUID.randomUUID(), "wrong-token"));

        assertEquals(HttpStatus.UNAUTHORIZED, error.getStatus());
        assertEquals("INVALID_INTERNAL_TOKEN", error.getCode());
        verify(modelRouter, never()).generate(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void validInternalRequestIsDelegatedToSpringRouter() {
        ReflectionTestUtils.setField(controller, "configuredInternalToken", "test-token");
        UUID jobId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();
        AIResponse aiResponse = AIResponse.builder().jobId(jobId).build();
        when(modelRouter.generate(jobId, executionId)).thenReturn(aiResponse);

        var response = controller.generateAIResult(jobId, executionId, "test-token");

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals(aiResponse, response.getBody());
        verify(modelRouter).generate(jobId, executionId);
    }
}
