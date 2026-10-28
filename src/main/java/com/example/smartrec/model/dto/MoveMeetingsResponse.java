package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

public record MoveMeetingsResponse(int movedCount, UUID folderId, List<UUID> meetingIds) {
}
