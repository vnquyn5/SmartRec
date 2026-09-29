package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class TrashMediaFileResponse {
    private UUID id;
    private String originalName;
    private String objectKey;
    private Long fileSize;
    private String mimeType;
    private String status;
    private String previousStatus;
    private Instant deletedAt;
    private Instant purgeAt;
    private long daysRemaining;
}
