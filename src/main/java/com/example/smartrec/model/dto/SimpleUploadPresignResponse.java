package com.example.smartrec.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class SimpleUploadPresignResponse {
    private String uploadUrl;
    private String objectKey;
    private Integer expiresIn;
}
