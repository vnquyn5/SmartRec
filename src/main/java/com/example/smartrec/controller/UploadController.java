package com.example.smartrec.controller;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.model.dto.ChunkUploadRequest;
import com.example.smartrec.model.dto.ChunkUploadResponse;
import com.example.smartrec.model.dto.FileUploadResponse;
import com.example.smartrec.model.dto.MergeUploadReponse;
import com.example.smartrec.model.dto.MergeUploadRequest;
import com.example.smartrec.model.dto.SimpleUploadCompleteRequest;
import com.example.smartrec.model.dto.SimpleUploadPresignRequest;
import com.example.smartrec.model.dto.SimpleUploadPresignResponse;
import com.example.smartrec.model.dto.UploadDuplicateCheckRequest;
import com.example.smartrec.model.dto.UploadDuplicateCheckResponse;
import com.example.smartrec.model.dto.UploadInitRequest;
import com.example.smartrec.model.dto.UploadInitResponse;
import com.example.smartrec.model.dto.UploadSessionStatusResponse;
import com.example.smartrec.service.FileService;
import com.example.smartrec.service.UploadService;
import org.springframework.http.MediaType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;



@RestController 
@RequestMapping("/upload")
@RequiredArgsConstructor 
public class UploadController {
    private static final Logger log = LoggerFactory.getLogger(UploadController.class);

    private final UploadService  uploadService;
    private final FileService fileService;

    @PostMapping(value = "/check-duplicate", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<UploadDuplicateCheckResponse> checkDuplicate(
            @Valid @RequestBody UploadDuplicateCheckRequest request) {
        return ResponseEntity.ok(fileService.checkDuplicate(request));
    }

    @PostMapping(value = "/presign", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<SimpleUploadPresignResponse> presignSimpleUpload(
            @Valid @RequestBody SimpleUploadPresignRequest request) {
        SimpleUploadPresignResponse response = fileService.presignSimpleUpload(request);
        return ResponseEntity.ok(response);
    }

    @PostMapping(value = "/complete", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<FileUploadResponse> completeSimpleUpload(
            @Valid @RequestBody SimpleUploadCompleteRequest request) {
        long startedAtNanos = System.nanoTime();
        log.info(
                "[simple-upload] complete request received objectKey={}, fileName={}, fileSize={}, mimeType={}, titlePresent={}",
                request.getObjectKey(),
                request.getFileName(),
                request.getFileSize(),
                request.getMimeType(),
                request.getTitle() != null && !request.getTitle().isBlank());
        FileUploadResponse response = fileService.completeSimpleUpload(request);
        log.info("[simple-upload] complete response returned objectKey={}, mediaFileId={}, meetingId={}, elapsedMs={}",
                request.getObjectKey(),
                response.getId(),
                response.getMeetingId(),
                elapsedMs(startedAtNanos));
        return ResponseEntity.ok(response);
    }

    private long elapsedMs(long startedAtNanos) {
        return (System.nanoTime() - startedAtNanos) / 1_000_000;
    }

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

            @RequestParam(value = "checksumSha256", required = false)
            String checksumSha256,

            @RequestParam("file")
            MultipartFile file) {
       ChunkUploadRequest request = ChunkUploadRequest.builder()
                .uploadSessionId(uploadSessionId)
                .chunkIndex(chunkIndex)
                .checksumMD5(checksumMD5)
                .checksumSha256(checksumSha256)
                .file(file)
                .build();

        ChunkUploadResponse response =
                uploadService.uploadChunk(request);

        return ResponseEntity.ok(response);
    }
    @PostMapping(value = "/merge", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity <MergeUploadReponse> mergeUpload(@RequestBody MergeUploadRequest request){
            MergeUploadReponse response = uploadService.mergeUpload(request);
            if ("MERGING".equals(response.getStatus())) {
                return ResponseEntity.status(HttpStatus.ACCEPTED).body(response);
            }
            return ResponseEntity.ok(response);
    }

    @GetMapping("/status")
    public ResponseEntity<UploadSessionStatusResponse> getUploadStatus(
            @RequestParam("uploadSessionId") String uploadSessionId) {
            return ResponseEntity.ok(uploadService.getUploadSessionStatus(uploadSessionId));
    }

    @PostMapping("/pause")
    public ResponseEntity<Void> pauseUpload(@RequestParam("uploadSessionId") String uploadSessionId) {
            uploadService.pauseUpload(uploadSessionId);
            return ResponseEntity.noContent().build();
    }

    @PostMapping("/resume")
    public ResponseEntity<Void> resumeUpload(@RequestParam("uploadSessionId") String uploadSessionId) {
            uploadService.resumeUpload(uploadSessionId);
            return ResponseEntity.noContent().build();
    }

    @PostMapping("/cancel")
    public ResponseEntity<Void> cancelUpload(@RequestParam("uploadSessionId") String uploadSessionId) {
            uploadService.cancelUpload(uploadSessionId);
            return ResponseEntity.noContent().build();
    }
    
    
    
    
}
