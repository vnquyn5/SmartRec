package com.example.smartrec.model.dto;

import java.util.List;

import com.example.smartrec.enums.JobStageStatus;
import com.example.smartrec.enums.PipelineStage;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder


public class WorkerCallbackRequest {
    private PipelineStage stage;
    private JobStageStatus status;
    private String errorCode;
    private String errorMessage;
    private List<SpeakerSegmentResponse> segments;
}
