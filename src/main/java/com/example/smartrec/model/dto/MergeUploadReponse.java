package com.example.smartrec.model.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data 
@AllArgsConstructor 
public class MergeUploadReponse {
    private String uploadSessionId;
    private String fileName;
    private String fileUrl;
    private String status;
    
}
