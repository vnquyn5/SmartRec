package com.example.smartrec.model.dto.request;

import java.util.UUID;

import com.example.smartrec.enums.ArtifactType;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
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
public class RegisterObjectRequest {

    @NotBlank(message = "Bucket must not be blank")
    @Size(max = 100, message = "Bucket name must not exceed 100 characters")
    private String bucket;

    @NotBlank(message = "Object key must not be blank")
    @Size(max = 1000, message = "Object key must not exceed 1000 characters")
    private String objectKey;

    @NotNull(message = "Artifact type is required")
    private ArtifactType artifactType;

    @NotNull(message = "Owner ID is required")
    private UUID ownerId;

    private UUID meetingId;
    private UUID jobId;
    private UUID parentObjectId;

    private Long sizeBytes;
    private String checksum;
    private String mimeType;
    private String metadata;
}
