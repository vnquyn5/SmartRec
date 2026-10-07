package com.example.smartrec.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

@Getter 
@Builder 
@AllArgsConstructor 
public class UploadInitResponse {
    private String uploadSessionId;
    private Long chunkSize;
    private Integer totalChunks;
    private String status;

    
}
