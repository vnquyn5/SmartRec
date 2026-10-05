package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.example.smartrec.entity.MeetingStatus;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
@Schema(description = "Meeting file returned by the meeting list API")
public class MeetingResponseDTO {
    private UUID id;
    private String title;
    private MeetingStatus status;
    private UUID mediaFileId;
    private String fileName;
    private String mimeType;
    private Long fileSizeBytes;
    private Integer durationSeconds;
    private Instant createdAt;
    private Instant updatedAt;
}