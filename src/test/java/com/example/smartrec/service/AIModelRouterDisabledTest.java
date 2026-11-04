package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import com.example.smartrec.config.AIModelRouterProperties;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.service.impl.AIModelRouter;
import com.example.smartrec.service.impl.GeminiFallbackService;
import com.fasterxml.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class AIModelRouterDisabledTest {
    @Mock private AIModelRouterProperties properties;
    @Mock private JobRepository jobRepository;
    @Mock private ContextPayloadService contextPayloadService;
    @Mock private LocalLLMAdapterClient localClient;
    @Mock private GeminiFallbackService geminiFallbackService;
    @Mock private AIResponseValidator responseValidator;
    @Mock private ObjectMapper objectMapper;
    @InjectMocks private AIModelRouter router;

    @Test
    void disabledRouterRejectsBeforeReadingEvidenceOrCallingProviders() {
        ReflectionTestUtils.setField(router, "enabled", false);

        BusinessException error = assertThrows(BusinessException.class,
                () -> router.generate(UUID.randomUUID(), UUID.randomUUID()));

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, error.getStatus());
        assertEquals("LLM_DISABLED", error.getCode());
        verifyNoInteractions(jobRepository, contextPayloadService, localClient,
                geminiFallbackService, responseValidator);
    }
}
