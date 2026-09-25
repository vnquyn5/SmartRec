package com.example.smartrec.controller;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.model.dto.ChunkUploadRequest;
import com.example.smartrec.model.dto.ChunkUploadResponse;
import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;
import com.example.smartrec.service.UploadService;
import org.springframework.http.MediaType;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;



@RestController 
@RequestMapping("/upload")
@RequiredArgsConstructor 
public class UploadController {
    private final UploadService  uploadService;
    @PostMapping("/init")
    public ResponseEntity<UploadInitResponse> initUpload( @Valid @RequestBody UploadInitRequest request) {
        UploadInitResponse response = uploadService.initUpload(request);
        return ResponseEntity.ok(response);
    }
    

    @PostMapping(value = "/chunk", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ChunkUploadResponse>uploadChunk( @RequestParam("uploadSessionId") String uploadSessionId,

            @RequestParam("chunkIndex")
            Integer chunkIndex,

            @RequestParam("checksumMD5")
            String checksumMD5,

            @RequestParam("file")
            MultipartFile file) {
       ChunkUploadRequest request = ChunkUploadRequest.builder()
                .uploadSessionId(uploadSessionId)
                .chunkIndex(chunkIndex)
                .checksumMD5(checksumMD5)
                .file(file)
                .build();

        ChunkUploadResponse response =
                uploadService.uploadChunk(request);

        return ResponseEntity.ok(response);
    }
    
    
}
