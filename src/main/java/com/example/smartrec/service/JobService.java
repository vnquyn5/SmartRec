package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.model.dto.CreateJobRequest;
import com.example.smartrec.model.dto.JobResponse;
import com.example.smartrec.model.dto.WorkerCallbackRequest;

public interface JobService {
    JobResponse createJob(CreateJobRequest request); // tao  process job moi
    JobResponse getJob(UUID jobId);  // lay thong tin 1 job
    JobResponse getJobForCurrentUser(UUID jobId);
    List<JobResponse>getDLQJob(); // lay ds trong DLQ
    List<JobResponse> getDLQJobsForCurrentUser();
    void processJob(UUID jobId); // tim job
    void manualRetry(UUID jobId); // retry job thu cong
    void manualRetryForCurrentUser(UUID jobId);
    void handleWorkerCallback(UUID jobId,WorkerCallbackRequest request); // iếp nhận kết quả từ Worker → cập nhật trạng thái Job/JobStage
    
} 
