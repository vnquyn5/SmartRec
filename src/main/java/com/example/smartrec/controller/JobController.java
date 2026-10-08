package com.example.smartrec.controller;

import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import com.example.smartrec.model.dto.CreateJobRequest;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.model.dto.WorkerCallbackRequest;
import com.example.smartrec.model.dto.WorkerJobControlResponse;
import com.example.smartrec.service.JobService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/jobs")
@RequiredArgsConstructor
public class JobController {

    private final JobService jobService;

    @Value("${smartrec.internal-token:}")
    private String configuredInternalToken;

    @PostMapping
    public ResponseEntity<JobResponse> createJob(
            @RequestBody CreateJobRequest request) {
        return ResponseEntity.ok(jobService.createJob(request));
    }

    @GetMapping("/{jobId}")
    public ResponseEntity<JobResponse> getJob(
            @PathVariable UUID jobId,
            @RequestHeader(value = "X-Internal-Token", required = false) String internalToken) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        boolean authenticatedUser = authentication != null
                && authentication.isAuthenticated()
                && !(authentication instanceof AnonymousAuthenticationToken);
        boolean internalWorker = internalToken != null
                && configuredInternalToken != null
                && !configuredInternalToken.isBlank()
                && configuredInternalToken.equals(internalToken.trim());
        if (!authenticatedUser && !internalWorker) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(internalWorker
                ? jobService.getJob(jobId)
                : jobService.getJobForCurrentUser(jobId));
    }

    @GetMapping("/dlq")
    public ResponseEntity<List<JobResponse>> getDLQJob() {
        return ResponseEntity.ok(jobService.getDLQJobsForCurrentUser());
    }

    @PostMapping("/{jobId}/retry")
    public ResponseEntity<Void> manualRetry(
            @PathVariable UUID jobId) {
        jobService.manualRetryForCurrentUser(jobId);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{jobId}/pause")
    public ResponseEntity<Void> pause(@PathVariable UUID jobId) {
        jobService.pauseForCurrentUser(jobId);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{jobId}/resume")
    public ResponseEntity<Void> resume(@PathVariable UUID jobId) {
        jobService.resumeForCurrentUser(jobId);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{jobId}/cancel")
    public ResponseEntity<Void> cancel(@PathVariable UUID jobId) {
        jobService.cancelForCurrentUser(jobId);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{jobId}/heartbeat")
    public ResponseEntity<WorkerJobControlResponse> heartbeat(
            @PathVariable UUID jobId,
            @RequestHeader(value = "X-Internal-Token", required = false) String internalToken) {
        if (internalToken == null || configuredInternalToken == null || configuredInternalToken.isBlank()
                || !configuredInternalToken.equals(internalToken.trim())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(jobService.workerHeartbeat(jobId));
    }

    @PostMapping("/{jobId}/callback")
    public ResponseEntity<Void> workerCallback(
            @PathVariable UUID jobId,
            @RequestHeader(value = "X-Internal-Token", required = false) String internalToken,
            @RequestBody WorkerCallbackRequest request) {

        if (internalToken == null || configuredInternalToken == null || configuredInternalToken.isBlank()
                || !configuredInternalToken.equals(internalToken.trim())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        jobService.handleWorkerCallback(jobId, request);
        return ResponseEntity.ok().build();
    }
}
