package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import com.google.auto.value.AutoValue.Builder;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import lombok.Getter;

@Getter 
@Builder 

public class MeetingSlideMetadataRequest {
    @NotNull 
    private UUID slideId;

    @NotNull
    private UUID meetingId;

    @NotNull
    private UUID jobId;

    @NotNull
    @PositiveOrZero
    private Long timestampMs;

    @NotBlank 
    @Size(max = 1024)
    private String objectKey;

    // Cho phép null hoặc chuỗi rỗng khi OCR không có kết quả.
    private String ocrText;

    @Size(max = 500)
    private String topic;

    private List<String> keywords;
}
