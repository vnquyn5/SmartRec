package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import com.example.smartrec.config.GeminiFallbackPolicyConfig;
import com.example.smartrec.service.impl.ContactRedactingGeminiFallbackPolicy;
import com.example.smartrec.service.impl.DenyAllGeminiFallbackPolicy;

class ContactRedactingGeminiFallbackPolicyTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withUserConfiguration(GeminiFallbackPolicyConfig.class);

    @Test
    void defaultAndUnknownPolicyVersionsDenySharing() {
        context.run(app -> assertInstanceOf(
                DenyAllGeminiFallbackPolicy.class, app.getBean(GeminiFallbackPolicy.class)));
        context.withPropertyValues("smartrec.ai-router.gemini-redaction-policy-version=unknown")
                .run(app -> assertInstanceOf(
                        DenyAllGeminiFallbackPolicy.class, app.getBean(GeminiFallbackPolicy.class)));
    }

    @Test
    void explicitPolicyVersionSelectsContactRedaction() {
        context.withPropertyValues("smartrec.ai-router.gemini-redaction-policy-version=contact-details-v1")
                .run(app -> assertInstanceOf(
                        ContactRedactingGeminiFallbackPolicy.class,
                        app.getBean(GeminiFallbackPolicy.class)));
    }

    @Test
    void redactsContactsButPreservesAssignmentsDatesAndCitations() {
        var policy = new ContactRedactingGeminiFallbackPolicy();
        var result = policy.authorizeAndRedact(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "System", "S1: Lan sẽ hoàn thành ngày 10 tháng 11 năm 2026 (10/11/2026). "
                        + "Email lan@example.com, gọi 0912345678, xem https://example.com/private.",
                1, 2048, 1, BigDecimal.ONE);

        assertTrue(result.isPresent());
        String prompt = result.orElseThrow().prompt();
        assertTrue(prompt.contains("S1: Lan sẽ hoàn thành ngày 10 tháng 11 năm 2026"));
        assertTrue(prompt.contains("10/11/2026"));
        assertTrue(prompt.contains("[REDACTED_EMAIL]"));
        assertTrue(prompt.contains("[REDACTED_PHONE]"));
        assertTrue(prompt.contains("[REDACTED_URL]"));
        assertFalse(prompt.contains("lan@example.com"));
        assertFalse(prompt.contains("0912345678"));
        assertFalse(prompt.contains("https://example.com/private"));
    }

    @Test
    void rejectsInvalidBudgetsBeforeAuthorizingContent() {
        var policy = new ContactRedactingGeminiFallbackPolicy();
        UUID id = UUID.randomUUID();
        assertTrue(policy.authorizeAndRedact(id, id, id, "system", "prompt",
                2, 2048, 1, BigDecimal.ONE).isEmpty());
        assertTrue(policy.authorizeAndRedact(id, id, id, "system", "prompt",
                1, 2048, 1, BigDecimal.ZERO).isEmpty());
        assertTrue(policy.authorizeAndRedact(id, id, id, "system", "prompt",
                1, 2048, 0, BigDecimal.ONE).isEmpty());
        assertEquals("system", policy.authorizeAndRedact(id, id, id, "system", "prompt",
                1, 2048, 1, BigDecimal.ONE).orElseThrow().systemPrompt());
    }
}
