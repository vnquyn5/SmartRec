package com.example.smartrec.service.impl;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import com.example.smartrec.model.dto.JobProgressEventReponse;
import com.example.smartrec.service.JobProgressPublisherService;

import lombok.RequiredArgsConstructor;


@Service 
@RequiredArgsConstructor 
public class JobProgressPublisherServiceImpl implements JobProgressPublisherService {
    private final SimpMessagingTemplate messagingTemplate;
     @Override
    public void publish(JobProgressEventReponse event) {

        // Mỗi Job có một topic riêng
        String destination = "/topic/jobs/" + event.getJobId();

        // Gửi event đến các Frontend đang subscribe topic này
        messagingTemplate.convertAndSend(destination, event);
    }
    
}
