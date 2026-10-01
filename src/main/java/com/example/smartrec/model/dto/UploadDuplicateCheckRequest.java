package com.example.smartrec.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UploadDuplicateCheckRequest {
    @NotBlank
    private String fileName;

    @NotNull
    @Positive
    private Long fileSize;

    private String quickFingerprint;

    private String checksumSha256;
}
