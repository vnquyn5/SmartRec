package com.example.smartrec.model.dto;

import org.springframework.web.multipart.MultipartFile;

import lombok.Builder;
import lombok.Data;
@Data 
@Builder 
public class ChunkUploadRequest {
    private String uploadSessionId;
    private Integer chunkIndex;
    private String checksumMD5;
    private MultipartFile file;
}   
