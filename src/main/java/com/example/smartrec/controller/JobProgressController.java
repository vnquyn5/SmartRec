package com.example.smartrec.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.JobSnapshotDTO;
import com.example.smartrec.service.JobProgressService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/jobs")
@RequiredArgsConstructor
public class JobProgressController {
    private final JobProgressService jobProgressService;

    @GetMapping("/{jobId}/snapshot")
    public ResponseEntity<JobSnapshotDTO> getSnapshot(
            @PathVariable UUID jobId) {

        JobSnapshotDTO snapshot = jobProgressService.getSnapshot(jobId);

        return ResponseEntity.ok(snapshot);
    }

}
