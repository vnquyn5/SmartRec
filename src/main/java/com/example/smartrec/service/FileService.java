package com.example.smartrec.service;

import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.model.dto.FileUploadResponse;

public interface FileService {
    FileUploadResponse upLoadFile(MultipartFile file, String title);
}
