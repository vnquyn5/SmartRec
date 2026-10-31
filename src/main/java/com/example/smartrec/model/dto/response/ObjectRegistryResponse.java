package com.example.smartrec.model.dto.response;

import java.time.Instant;
import java.util.UUID;

import com.example.smartrec.entity.ObjectRegistry;
import com.example.smartrec.enums.ArtifactType;
import com.example.smartrec.enums.ObjectState;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ObjectRegistryResponse {

    private UUID id;
    private String bucket;
    private String objectKey;
    private Long sizeBytes;
    private String checksum;
    private String mimeType;
    private ArtifactType artifactType;
    private ObjectState state;
    private UUID ownerId;
    private UUID meetingId;
    private UUID jobId;
    private UUID parentObjectId;
    private String metadata;
    private Instant createdAt;
    private Instant updatedAt;
    private Instant deletedAt;

    public static ObjectRegistryResponse fromEntity(ObjectRegistry entity) {
        return ObjectRegistryResponse.builder()
                .id(entity.getId())
                .bucket(entity.getBucket())
                .objectKey(entity.getObjectKey())
                .sizeBytes(entity.getSizeBytes())
                .checksum(entity.getChecksum())
                .mimeType(entity.getMimeType())
                .artifactType(entity.getArtifactType())
                .state(entity.getState())
                .ownerId(entity.getOwnerId())
                .meetingId(entity.getMeetingId())
                .jobId(entity.getJobId())
                .parentObjectId(entity.getParentObjectId())
                .metadata(entity.getMetadata())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .deletedAt(entity.getDeletedAt())
                .build();
    }
}
