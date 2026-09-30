package com.example.smartrec.model.dto;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class UploadSessionStatusResponse {
    private String uploadSessionId;
    private String status;
    private Integer receivedChunks;
    private Integer totalChunks;
    private List<Integer> missingChunks;
}
