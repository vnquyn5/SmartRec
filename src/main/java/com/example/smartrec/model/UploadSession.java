package com.example.smartrec.model;

import java.time.LocalDateTime;
import java.util.UUID;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import com.example.smartrec.enums.UploadSessionStatus;

@Data 
@Builder 
@AllArgsConstructor 
@NoArgsConstructor 
public class UploadSession {
     private UUID uploadSessionId;

    private UUID userId;

    private UUID workspaceId;

    private String fileName;

    private Long fileSize;

    private Integer totalChunks;

    private Long chunkSize;

    private Integer receivedChunks;

    private UploadSessionStatus  status;

    private LocalDateTime createdAt;
}
