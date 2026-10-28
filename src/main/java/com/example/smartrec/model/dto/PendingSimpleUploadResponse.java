package com.example.smartrec.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class PendingSimpleUploadResponse {
    private String objectKey;
    private String fileName;
    private Long fileSize;
    private String mimeType;
    private String title;
    private String quickFingerprint;
    private Integer fingerprintVersion;
    private String checksumSha256;
}
