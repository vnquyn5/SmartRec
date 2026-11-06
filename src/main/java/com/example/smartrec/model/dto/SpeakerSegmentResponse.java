package com.example.smartrec.model.dto;

import java.util.UUID;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@AllArgsConstructor
@NoArgsConstructor
public class SpeakerSegmentResponse {
    private UUID speakerId;
    /** Backward-compatible human-readable label. */
    private String speakerLabel;
    /** Stable diarization label; technical lookup must use speakerId. */
    private String aiLabel;
    private Integer speakerIndex;
    private String displayName;
    private Double startTime;
    private Double endTime;

    public SpeakerSegmentResponse(String speakerLabel, Double startTime, Double endTime) {
        this(null, speakerLabel, null, null, speakerLabel, startTime, endTime);
    }
}
