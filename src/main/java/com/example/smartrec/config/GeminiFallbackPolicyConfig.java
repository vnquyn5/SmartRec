package com.example.smartrec.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.example.smartrec.service.GeminiFallbackPolicy;
import com.example.smartrec.service.impl.DenyAllGeminiFallbackPolicy;

@Configuration
public class GeminiFallbackPolicyConfig {
    @Bean
    @ConditionalOnMissingBean(GeminiFallbackPolicy.class)
    GeminiFallbackPolicy denyUnapprovedGeminiSharing() {
        return new DenyAllGeminiFallbackPolicy();
    }
}
