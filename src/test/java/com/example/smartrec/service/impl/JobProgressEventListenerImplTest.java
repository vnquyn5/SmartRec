package com.example.smartrec.service.impl;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.service.JobProgressPublisherService;

@ExtendWith(MockitoExtension.class)
// Xác nhận listener chỉ phát qua broker sau commit và không làm hỏng transaction đã commit.
class JobProgressEventListenerImplTest {
    @Mock private JobProgressPublisherService publisherService;
    @InjectMocks private JobProgressEventListenerImpl listener;

    // Broker lỗi không được làm lỗi ngược về luồng xử lý job sau commit.
    @Test
    void websocketFailureAfterCommitDoesNotEscapeBackIntoTheJobTransaction() {
        JobProgressEventReponse event = new JobProgressEventReponse();
        event.setJobId(UUID.randomUUID());
        event.setEventId(UUID.randomUUID());
        doThrow(new IllegalStateException("broker unavailable")).when(publisherService).publish(event);

        assertDoesNotThrow(() -> listener.handleJobProgressEvent(event));
        verify(publisherService).publish(event);
    }

    // Listener phải được cấu hình đúng pha AFTER_COMMIT.
    @Test
    void publishListenerRunsOnlyAfterDatabaseCommit() throws Exception {
        var method = JobProgressEventListenerImpl.class
                .getMethod("handleJobProgressEvent", JobProgressEventReponse.class);
        assertEquals(
                TransactionPhase.AFTER_COMMIT, method.getAnnotation(TransactionalEventListener.class).phase());
    }
}
