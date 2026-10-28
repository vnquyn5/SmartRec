package com.example.smartrec.model.dto;

import java.util.UUID;

import com.google.auto.value.AutoValue.Builder;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.Setter;

@Getter 
@Setter 
@AllArgsConstructor 
public class SlideOCRResponse {
    private UUID slideId;
    private Long timestampMs;
    private String imageUrl;
    private String ocrText;
}
