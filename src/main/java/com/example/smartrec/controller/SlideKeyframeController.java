package com.example.smartrec.controller;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.entity.SlideKeyframe;
import com.example.smartrec.service.SlideKeyframeStorageService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/slide-keyframes")
@RequiredArgsConstructor
public class SlideKeyframeController {

    private final SlideKeyframeStorageService slideKeyframeStorageService;
     //Upload ảnh Keyframe lên MinIO và lưu metadata vào PostgreSQL.
    @PostMapping(
            value = "/meetings/{meetingId}",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<SlideKeyframe> uploadKeyframe(
            @PathVariable UUID meetingId,
            @RequestParam("timestampMs") Long timestampMs,
            @RequestParam("file") MultipartFile file) {

        SlideKeyframe keyframe =
                slideKeyframeStorageService.uploadKeyframe(
                        meetingId,
                        timestampMs,
                        file);

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(keyframe);
    }
}