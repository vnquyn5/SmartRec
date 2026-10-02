package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.model.dto.CreateJobRequest;
import com.example.smartrec.model.dto.JobResponse;

public interface JobService {
    JobResponse createJob(CreateJobRequest request); // tao  process job moi
    JobResponse getJob(UUID jobId);  // lay thong tin 1 job
    List<JobResponse>getDLQJob(); // lay ds trong DLQ
    void processJob(UUID jobId); // tim job
    void manualRetry(UUID jobId); // retry job thu cong
    
} 
