package com.example.smartrec.service;

import com.example.smartrec.model.dto.JobProgressEventReponse;

public interface JobProgressPublisherService {
    void publish(JobProgressEventReponse event);
} 