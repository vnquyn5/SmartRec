package com.example.smartrec.model.dto;

import java.math.BigDecimal;
import java.util.UUID;


import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class TranscriptItemRequest {
    private UUID speakerId;
    private Long startTimeMs;
    private Long endTimeMs;
    private String textContent;
    private BigDecimal confidenceScore;

}
