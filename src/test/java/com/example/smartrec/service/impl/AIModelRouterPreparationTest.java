package com.example.smartrec.service.impl;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.InternalLLMContracts;
import com.example.smartrec.model.dto.InternalLLMContracts.ContextEvidence;
import com.example.smartrec.model.dto.InternalLLMContracts.PrepareResponse;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

class AIModelRouterPreparationTest {
    private static final UUID REQUEST_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID JOB_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID MEETING_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID SOURCE_ID = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private final AIModelRouter router = new AIModelRouter(null, null, null, null, null, null, null);
    private final List<ContextEvidence> evidence = List.of(
            new ContextEvidence("TRANSCRIPT", SOURCE_ID, null, 1000L, 2000L, "private transcript"));

    @Test
    void acceptsCompletePrepareContract() {
        assertDoesNotThrow(() -> verify(valid()));
    }

    @ParameterizedTest(name = "{0} logs {1}")
    @MethodSource("invalidFields")
    void rejectsAndLogsOnlySafeFieldDiagnostics(String field, String type, String errorCode) {
        Logger logger = (Logger) org.slf4j.LoggerFactory.getLogger(AIModelRouter.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            BusinessException error = assertThrows(BusinessException.class,
                    () -> verify(invalid(field, type)));
            assertEquals(errorCode, error.getCode());
            String logged = appender.list.stream().map(ILoggingEvent::getFormattedMessage)
                    .reduce("", (left, right) -> left + right);
            assertTrue(logged.contains(field + ":" + type)
                    || logged.contains("field=" + field + " type=" + type));
            assertFalse(logged.contains("private transcript"));
            assertFalse(logged.contains("private system"));
            assertFalse(logged.contains("private fallback"));
            assertFalse(logged.contains("private prompt"));
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    private static Stream<Arguments> invalidFields() {
        return Stream.of(
                Arguments.of("contractVersion", "mismatch", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("schemaVersion", "mismatch", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("requestId", "mismatch", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("jobId", "mismatch", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("meetingId", "mismatch", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("taskType", "mismatch", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("systemPrompt", "blank", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("fallbackSystemPrompt", "missing", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("prompt", "blank", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("allowedSourceRefs", "missing", "AI_PREPARE_RESPONSE_INVALID"),
                Arguments.of("allowedSourceRefs", "mismatch", "AI_SOURCE_ALLOWLIST_INVALID"));
    }

    private void verify(PrepareResponse response) {
        router.verifyPreparation(response, REQUEST_ID, JOB_ID, MEETING_ID, evidence);
    }

    private PrepareResponse valid() {
        return new PrepareResponse(InternalLLMContracts.VERSION, REQUEST_ID, JOB_ID, MEETING_ID,
                "MEETING_ANALYSIS", "private system", "private fallback", "private prompt",
                List.of("S1"), InternalLLMContracts.SUMMARY_SCHEMA_VERSION);
    }

    private PrepareResponse invalid(String field, String type) {
        PrepareResponse value = valid();
        return new PrepareResponse(
                field.equals("contractVersion") ? "invalid" : value.contractVersion(),
                field.equals("requestId") ? UUID.randomUUID() : value.requestId(),
                field.equals("jobId") ? UUID.randomUUID() : value.jobId(),
                field.equals("meetingId") ? UUID.randomUUID() : value.meetingId(),
                field.equals("taskType") ? "OTHER" : value.taskType(),
                field.equals("systemPrompt") ? " " : value.systemPrompt(),
                field.equals("fallbackSystemPrompt") ? null : value.fallbackSystemPrompt(),
                field.equals("prompt") ? " " : value.prompt(),
                field.equals("allowedSourceRefs")
                        ? "missing".equals(type) ? null : List.of("S2")
                        : value.allowedSourceRefs(),
                field.equals("schemaVersion") ? "invalid" : value.schemaVersion());
    }
}
