package com.example.smartrec.model.dto;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data 
public class MergeUploadRequest {

    // @NotNull(message = "uploadSessionId là bắt buộc")
    private String uploadSessionId;
    
    private String fileName;
    
}
