package com.example.smartrec.model.dto;

import java.util.UUID;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class AiUsageRequest {
    @NotNull
    private UUID requestId;
    @NotNull
    private UUID jobId;
    private UUID meetingId;
    @NotBlank
    @Size(max = 255)
    private String modelName;
    @Size(max = 100)
    private String modelVersion;
    @NotBlank
    @Pattern(regexp = "LOCAL|GEMINI")
    private String provider;
    @NotBlank
    @Size(max = 100)
    private String taskType;
    @Min(0)
    private Long inputTokens;
    @Min(0)
    private Long outputTokens;
    @Min(0)
    private Long totalTokens;
    @NotBlank
    @Pattern(regexp = "provider_metadata|gemini_metadata|ollama_metadata|unavailable")
    private String tokenSource;
    @NotNull
    @Min(0)
    private Long processingTimeMs;
    @NotBlank
    @Pattern(regexp = "success|failed")
    private String status;
    private boolean fallbackUsed;
    @DecimalMin("0.0")
    private Double estimatedCost;
    @Size(max = 100)
    private String errorCode;
}
