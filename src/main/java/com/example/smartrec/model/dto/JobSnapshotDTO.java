package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class JobSnapshotDTO {

    private UUID jobId;

    private UUID meetingId;

    private String status;

    @JsonProperty("current_stage")
    private String currentStage;

    @JsonProperty("progress_percent")
    private Integer progressPercent;

    // Sequence mới nhất tại thời điểm lấy snapshot
    private Long sequence;

    private Instant updatedAt;
}