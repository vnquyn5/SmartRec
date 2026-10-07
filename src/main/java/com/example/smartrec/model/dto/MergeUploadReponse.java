package com.example.smartrec.model.dto;

import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class MergeUploadReponse {
    private String uploadSessionId;
    private String fileName;
    private String fileUrl;
    private String status;
    private UUID mediaFileId;
    private UUID meetingId;

    public MergeUploadReponse(String uploadSessionId, String fileName, String fileUrl, String status) {
        this.uploadSessionId = uploadSessionId;
        this.fileName = fileName;
        this.fileUrl = fileUrl;
        this.status = status;
    }
}
