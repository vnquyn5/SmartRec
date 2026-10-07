package com.example.smartrec.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter 
@AllArgsConstructor 
public class SpeakerSegmentResponse {
    private String speakerLabel;
    private Double startTime;
    private Double endTime;
    
}
