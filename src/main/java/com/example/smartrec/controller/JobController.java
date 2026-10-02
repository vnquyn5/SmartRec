package com.example.smartrec.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.CreateJobRequest;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.service.JobService;

import org.springframework.web.bind.annotation.RequestBody;
import lombok.RequiredArgsConstructor;

@RestController 
@RequestMapping ("/jobs")
@RequiredArgsConstructor 
public class JobController {
     private final JobService jobService;

    @PostMapping
    public ResponseEntity<JobResponse> createJob(
            @RequestBody  CreateJobRequest request) {

        return ResponseEntity.ok(
                jobService.createJob(request)
        );
    }

    @GetMapping("/{jobId}")
    public ResponseEntity<JobResponse> getJob(
            @PathVariable UUID jobId) {

        return ResponseEntity.ok(
                jobService.getJob(jobId)
        );
    }

    @GetMapping("/dlq")
    public ResponseEntity<List<JobResponse>> getDLQJob() {

        return ResponseEntity.ok(
                jobService.getDLQJob()
        );
    }

    @PostMapping("/{jobId}/retry")
    public ResponseEntity<Void> manualRetry(
            @PathVariable UUID jobId) {

        jobService.manualRetry(jobId);

        return ResponseEntity.ok().build();
    }
}
