package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.example.smartrec.entity.Folder;

public record FolderResponse(UUID id, String name, UUID parentId, Instant createdAt, Instant updatedAt) {
    public static FolderResponse from(Folder folder) {
        return new FolderResponse(folder.getId(), folder.getName(), folder.getParentId(), folder.getCreatedAt(), folder.getUpdatedAt());
    }
}
