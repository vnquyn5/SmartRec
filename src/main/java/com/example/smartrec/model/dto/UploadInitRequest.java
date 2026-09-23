package com.example.smartrec.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;

@Data 
public class UploadInitRequest {

    @NotBlank(message = "Tên tệp không được để trống ")
    private String fileName;

    @NotNull (message = "Kích thức tệp không được để trống ")
    @Positive (message = "kích thước tệp phải lớn hơn 0 ")
    private Long fileSize;

    @NotNull (message = "Bắt buộc phải có tổng số phần ")
    @Positive (message = "Tổng số phần phải lớn hơn 0")
    private Integer totalChunks;

    
}
