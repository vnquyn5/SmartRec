package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

/** Internal snapshot of persisted evidence; never overwrites meeting-wide context. */
public record JobContext(UUID meetingId, UUID jobId, List<Evidence> evidence) {
    public record Evidence(String sourceType, UUID sourceId, UUID speakerId,
                           Long startTimeMs, Long endTimeMs, String text) {}
}
