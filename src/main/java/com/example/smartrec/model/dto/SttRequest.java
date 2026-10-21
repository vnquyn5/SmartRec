package com.example.smartrec.model.dto;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data 
public class SttRequest {
    @NotNull (message = "meetingId không được để trống")
    private UUID meetingId;
    @NotNull (message = "processingJobId không được để")
    private UUID processingJobId;
    private String modelName;
    private String language;
}
