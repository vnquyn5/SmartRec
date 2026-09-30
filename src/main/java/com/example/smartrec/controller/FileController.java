package com.example.smartrec.controller;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.model.dto.FileUploadResponse;
import com.example.smartrec.service.FileService;

import lombok.AllArgsConstructor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;

@RestController
@RequestMapping("/meetings")
@AllArgsConstructor
public class FileController {
    private static final Logger log = LoggerFactory.getLogger(FileController.class);

    private final FileService fileService;

    @PostMapping(value = "/upload", consumes = "multipart/form-data")
    public ResponseEntity<FileUploadResponse> upLoad(@RequestParam("file") MultipartFile file,
            @RequestParam(value = "title", required = false) String title) {
        long requestStartNanos = System.nanoTime();
        log.info(
                "[simple-upload] request received fileName={}, sizeBytes={}, contentType={}, titlePresent={}",
                file != null ? file.getOriginalFilename() : null,
                file != null ? file.getSize() : null,
                file != null ? file.getContentType() : null,
                title != null && !title.isBlank());
        FileUploadResponse response = fileService.upLoadFile(file, title);
        log.info(
                "[simple-upload] response returned mediaFileId={}, meetingId={}, totalMs={}",
                response.getId(),
                response.getMeetingId(),
                elapsedMs(requestStartNanos));
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    private long elapsedMs(long startedAtNanos) {
        return (System.nanoTime() - startedAtNanos) / 1_000_000;
    }
}
