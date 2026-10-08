package com.example.smartrec.service;

import java.util.UUID;

public interface JobQueueService {
    void enqueueJob(UUID jobId);
}
