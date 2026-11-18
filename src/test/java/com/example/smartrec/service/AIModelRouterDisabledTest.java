package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.mock;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import com.example.smartrec.controller.AIInferenceController;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.impl.AIModelRouter;

class AIModelRouterDisabledTest {
    @Test
    void disabledLlmRejectsBeforeCallingRouter() {
        AIModelRouter router = mock(AIModelRouter.class);
        AIInferenceController controller = new AIInferenceController(router);
        ReflectionTestUtils.setField(controller, "configuredInternalToken", "test-token");
        ReflectionTestUtils.setField(controller, "llmEnabled", false);

        BusinessException error = assertThrows(BusinessException.class,
                () -> controller.generateAIResult(UUID.randomUUID(), UUID.randomUUID(), "test-token"));

        assertEquals(HttpStatus.CONFLICT, error.getStatus());
        assertEquals("LLM_DISABLED", error.getCode());
        verifyNoInteractions(router);
    }
}
