package com.example.smartrec.service.impl;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import com.example.smartrec.service.JobQueueService;

import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class JobQueueServiceImpl implements JobQueueService {

    private final RestTemplate restTemplate;
    private final String internalToken;

    public JobQueueServiceImpl(
            RestTemplateBuilder builder,
            @Value("${smartrec.ai-engine.base-url:http://localhost:8000}") String aiEngineBaseUrl,
            @Value("${smartrec.internal-token:}") String internalToken) {

        this.restTemplate = builder
                .rootUri(aiEngineBaseUrl)
                .setConnectTimeout(Duration.ofSeconds(5))
                .setReadTimeout(Duration.ofSeconds(10))
                .build();

        this.internalToken = internalToken;
    }

    @Override
    public void enqueueJob(UUID jobId) {

        if (internalToken == null || internalToken.isBlank()) {
            throw new IllegalStateException(
                    "SMARTREC_INTERNAL_TOKEN must be configured to enqueue AI jobs"
            );
        }

        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", internalToken);

        try {
            restTemplate.exchange(
                    "/internal/jobs/{jobId}/enqueue",
                    HttpMethod.POST,
                    new HttpEntity<>(headers),
                    Map.class,
                    jobId
            );
        } catch (RuntimeException e) {
            log.error(
                    "Failed to enqueue AI job {} through AI Engine",
                    jobId,
                    e
            );
            throw e;
        }
    }
}