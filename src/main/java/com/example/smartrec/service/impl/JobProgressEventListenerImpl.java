package com.example.smartrec.service.impl;

import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.service.JobProgressPublisherService;

import lombok.RequiredArgsConstructor;

/**
 * Cầu nối giữa domain event trong Spring và message gửi tới STOMP broker.
 * Listener chạy sau commit để subscriber không nhìn thấy thay đổi chưa bền vững trong database.
 */
@Service 
@RequiredArgsConstructor 
public class JobProgressEventListenerImpl {
    private static final Logger log = LoggerFactory.getLogger(JobProgressEventListenerImpl.class);

    /** Thành phần gửi payload tới topic tương ứng của Job. */
    private final JobProgressPublisherService publisherService;

    /**
     * Chuyển event ra broker sau khi transaction chứa thay đổi Job đã commit thành công.
     * Nếu transaction rollback, listener không gửi event và client có thể lấy lại trạng thái bằng snapshot.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleJobProgressEvent(JobProgressEventReponse event) {
        try {
            publisherService.publish(event);
        } catch (RuntimeException ex) {
            // Commit đã hoàn tất nên không thể rollback lại Job; ghi log để chẩn đoán và dùng REST snapshot để đồng bộ.
            log.warn("Job progress publish failed after commit: jobId={}, eventId={}, errorType={}",
                    event.getJobId(), event.getEventId(), ex.getClass().getSimpleName());
        }
    }
    
}
