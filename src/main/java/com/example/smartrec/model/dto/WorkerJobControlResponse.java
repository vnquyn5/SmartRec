package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.enums.PipelineStage;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class WorkerJobControlResponse {
    private UUID jobId;
    private UUID meetingId;
    private String objectKey;
    private JobStatus status;
    private PipelineStage currentStage;
    private List<PipelineStage> successfulStages;
}
