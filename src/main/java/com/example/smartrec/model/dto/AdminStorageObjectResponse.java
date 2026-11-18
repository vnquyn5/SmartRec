package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

public record AdminStorageObjectResponse(
        UUID id,
        UUID workspaceId,
        UUID uploadedBy,
        String uploaderName,
        String uploaderEmail,
        String originalName,
        String objectKey,
        String mimeType,
        long fileSizeBytes,
        Integer durationSeconds,
        String status,
        String previousStatus,
        boolean hasLinkedMeeting,
        Instant createdAt,
        Instant deletedAt,
        Instant purgeAt
) {
}

