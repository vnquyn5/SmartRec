package com.example.smartrec.model.dto;

import java.util.UUID;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class UploadDuplicateCheckResponse {
    private boolean exists;
    private boolean possibleDuplicate;
    private boolean requireFullChecksum;
    private UUID mediaFileId;
    private String existingFileName;
    private Long fileSize;
    private String objectKey;

    public static UploadDuplicateCheckResponse noDuplicate() {
        return new UploadDuplicateCheckResponse(false, false, false, null, null, null, null);
    }

    public static UploadDuplicateCheckResponse possibleDuplicate() {
        return new UploadDuplicateCheckResponse(false, true, true, null, null, null, null);
    }

    public static UploadDuplicateCheckResponse exactDuplicate(
            UUID mediaFileId,
            String existingFileName,
            Long fileSize,
            String objectKey) {
        return new UploadDuplicateCheckResponse(true, true, false, mediaFileId, existingFileName, fileSize, objectKey);
    }
}
