package com.example.smartrec.model.dto;

import lombok.Builder;
import lombok.Data;
 
@Data
@Builder  
public class ChunkUploadResponse {
    private String uploadSessionId;
    private Integer chunkIndex;
    private String status;
    private String message;
}
