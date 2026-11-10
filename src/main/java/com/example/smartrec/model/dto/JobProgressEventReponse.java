package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class JobProgressEventReponse {

    private String eventType;

    private String version;

    private UUID jobId;

    private UUID meetingId;

    private UUID eventId;

    // Số thứ tự event của Job
    private Long sequence;

    private Instant timestamp;

    @JsonProperty("current_stage")
    private String currentStage;

    private String status;

    @JsonProperty("progress_percent")
    private Integer progressPercent;
}