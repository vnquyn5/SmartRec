package com.example.smartrec.entity;

import java.util.UUID;

import com.google.auto.value.AutoValue.Builder;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity 
@Table (name = "ocr_results")
@Getter 
@Setter 
@Builder 
@AllArgsConstructor 
@NoArgsConstructor 
public class OCRResult {

    @Id 
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "keyframe_id", nullable = false)
    private UUID keyframeId;

    @Column(name = "extracted_text", columnDefinition = "TEXT")
    private String extractedText;
}
