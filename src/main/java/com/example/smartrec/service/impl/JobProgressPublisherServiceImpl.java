package com.example.smartrec.service.impl;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;

import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.service.JobProgressPublisherService;

import lombok.RequiredArgsConstructor;


/** Gửi domain event đến topic riêng theo Job ID sau khi listener nhận được event đã commit. */
@Service
@RequiredArgsConstructor
public class JobProgressPublisherServiceImpl implements JobProgressPublisherService {
    /** API Spring Messaging để gửi message vào destination của broker STOMP. */
    private final SimpMessagingTemplate messagingTemplate;

    /** Phải khớp broker prefix trong WebSocketConfig và allowlist subscribe của interceptor. */
    @Value("${websocket.broker-prefix:/topic}")
    private String brokerPrefix;

    /**
     * Phát event đến {@code /topic/jobs/{jobId}} để các client đã được authorize nhận cập nhật.
     *
     * @param event payload có trạng thái Job, progress, sequence và event ID
     */
    @Override
    public void publish(JobProgressEventReponse event) {
        // Tách topic theo Job để client chỉ subscribe luồng mà mình cần; interceptor kiểm tra quyền trước subscribe.
        String destination = brokerPrefix + "/jobs/" + event.getJobId();

        // Gửi toàn bộ event tới subscriber hiện có; snapshot riêng được gửi qua /user/queue/ai-progress.
        messagingTemplate.convertAndSend(destination, event);
    }
    
}
