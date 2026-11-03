package com.example.smartrec.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.TranscriptRequest;
import com.example.smartrec.model.dto.TranscriptResponse;
import com.example.smartrec.service.TranscriptService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/transcripts")
@RequiredArgsConstructor
public class TranscriptController {

    private final TranscriptService transcriptService;

    /**
     * Lưu danh sách câu thoại Transcript của một meeting/job.
     */
    @PostMapping
    public ResponseEntity<List<TranscriptResponse>> saveTranscripts(
            @Valid @RequestBody TranscriptRequest request) {

        List<TranscriptResponse> responses =
                transcriptService.saveTranscript(request);

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(responses);
    }

    /**
     * Lấy danh sách Transcript theo Meeting ID.
     */
    @GetMapping("/meeting/{meetingId}")
    public ResponseEntity<List<TranscriptResponse>> getTranscriptsByMeeting(
            @PathVariable UUID meetingId) {

        List<TranscriptResponse> responses =
                transcriptService.getTranscriptsByMeeting(meetingId);

        return ResponseEntity.ok(responses);
    }

    /**
     * Lấy danh sách Transcript theo Processing Job ID.
     */
    @GetMapping("/job/{processingJobId}")
    public ResponseEntity<List<TranscriptResponse>> getTranscriptsByJob(
            @PathVariable UUID processingJobId) {

        List<TranscriptResponse> responses =
                transcriptService.getTranscriptsByJob(processingJobId);

        return ResponseEntity.ok(responses);
    }
}