package com.example.smartrec.config;

import java.math.BigDecimal;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "smartrec.ai-router")
public class AIModelRouterProperties {
    private int localMaxAttempts = 2;
    private long localRetryBackoffMs = 100;
    private int localCircuitFailureThreshold = 3;
    private long localCircuitOpenMs = 30_000;

    private boolean geminiFallbackEnabled;
    private boolean geminiDataSharingApproved;
    private String geminiRedactionPolicyVersion;
    private String geminiApiKey;
    private String geminiModel;
    private int geminiTimeoutMs = 30_000;
    private int geminiMaxAttempts = 1;
    private int geminiMaxRequestsPerJob;
    private BigDecimal geminiMaxCostPerJobUsd = BigDecimal.ZERO;
    private int geminiMaxOutputTokens = 2048;
}
