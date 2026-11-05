package com.example.smartrec.controller;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.impl.AIModelRouter;

class AIInferenceControllerTest {
    @Test
    void llmDisabledRejectsDirectRouterCallsAfterAuthentication() {
        AIModelRouter router = mock(AIModelRouter.class);
        AIInferenceController controller = new AIInferenceController(router);
        ReflectionTestUtils.setField(controller, "configuredInternalToken", "test-token");
        ReflectionTestUtils.setField(controller, "llmEnabled", false);

        assertThrows(BusinessException.class, () -> controller.generateAIResult(
                UUID.randomUUID(), UUID.randomUUID(), "test-token"));
        verifyNoInteractions(router);
    }
}
