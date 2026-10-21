package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Data;

@Data 
public class SttResultRequest {
    @NotNull (message = "meetingId không được để trống")
    private UUID meetingId;
    @NotNull (message = "processingJobId không được để")
    private UUID processingJobId;
    @NotNull(message = "success không được để trống")
    private Boolean success;
    private String text;
    private String language;
    private String modelName;
    private String errorMessage;

    @Valid 
    private List<TranscriptSegment> segments;
    @Data 
    public static class TranscriptSegment {
        @NotNull (message = "speakerId không được để trống")
        private UUID speakerId;

        @NotNull (message = "startTimeMs không được để trống ")
        @PositiveOrZero (message = "startTimeMs phải >= 0 ")
        private Long startTimeMs;

        @NotNull (message = "endTimeMs không được để trống ")
        @PositiveOrZero (message = "endTimeMs phải >= 0 ")
        private Long endTimeMs;

        @NotBlank (message = "text không được để trống")
        private String text;
    }
} 
