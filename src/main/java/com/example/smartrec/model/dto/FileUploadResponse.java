package com.example.smartrec.model.dto;

import java.util.UUID;

import lombok.AllArgsConstructor;
import lombok.Getter;

@AllArgsConstructor 
@Getter 
public class FileUploadResponse {
    private UUID id;
    private UUID meetingId;
    private String original_name;
    private String object_key;
    private String mime_type ;
    private Long file_size_bytes;
    private Integer duration_seconds;
    private String fileStatus;
    private String meetingStatus;
    
}
