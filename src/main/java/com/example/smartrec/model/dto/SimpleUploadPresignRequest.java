package com.example.smartrec.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SimpleUploadPresignRequest {
    @NotBlank
    private String fileName;

    @NotNull
    @Positive
    private Long fileSize;

    private String mimeType;
}
