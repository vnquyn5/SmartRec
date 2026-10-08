package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.PipelineStage;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Builder


public class WorkerCallbackRequest {
    private UUID executionId;
    private PipelineStage stage;
    private JobStageStatus status;
    private String errorCode;
    private String errorMessage;
    private List<SpeakerSegmentResponse> segments;
}
