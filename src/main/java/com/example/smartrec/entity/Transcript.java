package com.example.smartrec.entity;

import java.math.BigDecimal;
import java.util.UUID;


import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity 
@Table (name = "transcripts")
@Setter 
@Getter 
@Builder 
@AllArgsConstructor 
@NoArgsConstructor 
public class Transcript {
    @Id 
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column (name = "meeting_id",nullable = false)
    private UUID meetingId;

    @Column (name = "processing_job_id",nullable = false) 
    private UUID processingJobId;

    @Column (name = "speaker_id",nullable = false)
    private UUID speakerId;

    @Column (name = "start_time_ms",nullable = false)
    private Long startTimeMs;

    @Column (name = "end_time_ms",nullable = false)
    private Long endTimeMs;

    @Column (name = "text_content",nullable = false,columnDefinition = "TEXT")
    private String textContent;

    @Column (name = "confidence_score",precision = 4,scale = 3)
    private BigDecimal confidenceScore;

    
}
