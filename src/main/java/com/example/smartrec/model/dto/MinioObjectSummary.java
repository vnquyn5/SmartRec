package com.example.smartrec.model.dto;

import java.time.Instant;

public record MinioObjectSummary(
        String objectKey,
        long sizeBytes,
        Instant lastModified,
        String etag
) {
}

