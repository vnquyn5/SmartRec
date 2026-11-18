package com.example.smartrec.service.impl;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.service.JobProgressPublisherService;

@Service 
public class JobProgressEventListenerImpl {
    private static final Logger log = LoggerFactory.getLogger(JobProgressEventListenerImpl.class);
    private final TaskExecutor jobProgressTaskExecutor;
    private final JobProgressPublisherService publisherService;

    public JobProgressEventListenerImpl(
            @Qualifier("jobProgressTaskExecutor") TaskExecutor jobProgressTaskExecutor,
            JobProgressPublisherService publisherService) {
        this.jobProgressTaskExecutor = jobProgressTaskExecutor;
        this.publisherService = publisherService;
    }

    // Chỉ gửi WebSocket sau khi database commit thành công
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleJobProgressEvent(JobProgressEventReponse event) {
        try {
            // The event is an immutable DTO snapshot; the worker thread does not read JPA state.
            jobProgressTaskExecutor.execute(() -> publish(event));
        } catch (RuntimeException error) {
            // Saturation or shutdown must not turn a committed Job update into a failed request.
            log.warn("Could not schedule committed Job progress event jobId={} sequence={}",
                    event.getJobId(), event.getSequence(), error);
        }
    }

    private void publish(JobProgressEventReponse event) {
        try {
            publisherService.publish(event);
        } catch (RuntimeException error) {
            // The Job is committed already; broker failure must not reverse its result.
            log.warn("Could not publish committed Job progress event jobId={} sequence={}",
                    event.getJobId(), event.getSequence(), error);
        }
    }
    
}
