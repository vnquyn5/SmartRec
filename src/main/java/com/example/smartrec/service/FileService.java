package com.example.smartrec.service;

import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.model.dto.FileUploadResponse;
import com.example.smartrec.model.dto.SimpleUploadCompleteRequest;
import com.example.smartrec.model.dto.SimpleUploadPresignRequest;
import com.example.smartrec.model.dto.SimpleUploadPresignResponse;

public interface FileService {
    FileUploadResponse upLoadFile(MultipartFile file, String title);

    SimpleUploadPresignResponse presignSimpleUpload(SimpleUploadPresignRequest request);

    FileUploadResponse completeSimpleUpload(SimpleUploadCompleteRequest request);
}
