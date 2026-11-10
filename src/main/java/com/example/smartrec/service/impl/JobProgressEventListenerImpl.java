package com.example.smartrec.service.impl;

import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.service.JobProgressPublisherService;

import lombok.RequiredArgsConstructor;

@Service 
@RequiredArgsConstructor 
public class JobProgressEventListenerImpl {
    private final JobProgressPublisherService publisherService;
    // Chỉ gửi WebSocket sau khi database commit thành công
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleJobProgressEvent(JobProgressEventReponse event) {

        publisherService.publish(event);
    }
    
}
