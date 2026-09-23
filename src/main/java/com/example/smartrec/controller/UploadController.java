package com.example.smartrec.controller;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.UploadSession;
import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;
import com.example.smartrec.service.UploadService;

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
    
    
}
