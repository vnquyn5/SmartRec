package com.example.smartrec.model.dto;

import lombok.Data;

@Data 
public class MergeUploadRequest {

    // @NotNull(message = "uploadSessionId là bắt buộc")
    private String uploadSessionId;
    
    private String fileName;
    
}
