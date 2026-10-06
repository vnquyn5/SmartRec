package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.enums.PipelineStage;

import lombok.Builder;
import lombok.Data;

@Data 
@Builder 
public class JobResponse {
    private UUID id;
    private UUID mediaFileId;
    private JobStatus status;
    private PipelineStage stage;
    private Integer retryCount;
    private String errorCode;
    private String errorMessage;
    private Instant failedAt;
    private Instant lastRetryAt;
    private Instant updatedAt;
    private Instant createdAt;
    
}
