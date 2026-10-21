package com.example.smartrec.model.dto;

import java.util.UUID;

import com.google.auto.value.AutoValue.Builder;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter 
@Builder 
@AllArgsConstructor 

public class SttResponse {
    private UUID meetingId;
    private UUID processingJobId;
    private String status;
    private String message;
}
