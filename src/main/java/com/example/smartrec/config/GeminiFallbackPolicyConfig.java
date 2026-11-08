package com.example.smartrec.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.example.smartrec.service.GeminiFallbackPolicy;
import com.example.smartrec.service.impl.DenyAllGeminiFallbackPolicy;
import com.example.smartrec.service.impl.ContactRedactingGeminiFallbackPolicy;

@Configuration
public class GeminiFallbackPolicyConfig {
    @Bean
    @ConditionalOnProperty(prefix = "smartrec.ai-router", name = "gemini-redaction-policy-version",
            havingValue = "contact-details-v1")
    GeminiFallbackPolicy approvedContactRedaction() {
        return new ContactRedactingGeminiFallbackPolicy();
    }

    @Bean
    @ConditionalOnMissingBean(GeminiFallbackPolicy.class)
    GeminiFallbackPolicy denyUnapprovedGeminiSharing() {
        return new DenyAllGeminiFallbackPolicy();
    }
}
