package com.example.smartrec.service;

import java.util.UUID;

public interface JobQueueService {
    void enqueueJob(UUID jobId); // dua job moi vao main queue
    void enqueueRetry(UUID jobId);// dua job loi vao retry queue 
    void enqueueDLQ(UUID jobId); // dua het job retry queue  vao DLQ
    String pollJob();// lay job tu main queue
    String pollRetryJob();// lay job tu retry queue 
    String pollDLQ();// lay job tu DLQ
    
} 
