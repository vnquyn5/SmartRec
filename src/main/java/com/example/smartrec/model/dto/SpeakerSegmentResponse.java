package com.example.smartrec.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SpeakerSegmentResponse {
    private String speakerLabel;
    private Double startTime;
    private Double endTime;
}