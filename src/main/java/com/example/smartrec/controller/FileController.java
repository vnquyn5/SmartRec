package com.example.smartrec.controller;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.model.dto.FileUploadResponse;
import com.example.smartrec.service.FileService;

import lombok.AllArgsConstructor;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;

@RestController
@RequestMapping("/meetings")
@AllArgsConstructor
public class FileController {
    private final FileService fileService;

    @PostMapping(value = "/upload", consumes = "multipart/form-data")
    public ResponseEntity<FileUploadResponse> upLoad(@RequestParam("file") MultipartFile file,
            @RequestParam(value = "title", required = false) String title) {
        FileUploadResponse response = fileService.upLoadFile(file, title);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

}
