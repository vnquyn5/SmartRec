package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.List;

import com.example.smartrec.enums.StorageCleanupTaskType;

public record StorageCleanupResponse(
        StorageCleanupTaskType taskType,
        int processedCount,
        int deletedCount,
        int failedCount,
        long freedBytes,
        Instant executedAt,
        String message,
        List<String> errors
) {
}

