package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class JobProgressEventReponse {

    private final String eventType;

    private final String version;

    private final UUID jobId;

    private final UUID meetingId;

    private final UUID eventId;

    // Số thứ tự event của Job
    private final Long sequence;

    private final Instant timestamp;

    @JsonProperty("current_stage")
    private final String currentStage;

    private final String status;

    @JsonProperty("progress_percent")
    private final Integer progressPercent;
}
