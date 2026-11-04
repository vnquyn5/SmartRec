package com.example.smartrec.model.dto;

import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;


import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class AIResponse {
     private UUID jobId;

    private UUID meetingId;

    private UUID requestId;

    private String taskType;

    private String provider;

    private String model;

    private boolean fallbackUsed;

    private String fallbackReason;

    private Integer retryCount;

    private Long latencyMs;

    private String status;

    private JsonNode result;

    private Long inputTokens;

    private Long outputTokens;

    private String tokenSource;

    private Double estimatedCost;
}
