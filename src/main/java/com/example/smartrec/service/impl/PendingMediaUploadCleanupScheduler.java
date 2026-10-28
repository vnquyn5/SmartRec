package com.example.smartrec.service.impl;

import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.PendingMediaUpload;
import com.example.smartrec.repository.PendingMediaUploadRepository;
import com.example.smartrec.service.MinioService;

import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class PendingMediaUploadCleanupScheduler {
    private static final Logger log = LoggerFactory.getLogger(PendingMediaUploadCleanupScheduler.class);

    private final PendingMediaUploadRepository pendingUploadRepository;
    private final MinioService minioService;

    @Scheduled(fixedDelayString = "${upload.pending-cleanup-interval-ms:3600000}")
    @Transactional
    public void cleanupExpiredPendingUploads() {
        var expiredUploads = pendingUploadRepository
                .findTop100ByStatusAndExpiresAtBeforeOrderByExpiresAtAsc("PENDING", Instant.now());
        for (PendingMediaUpload pending : expiredUploads) {
            try {
                if (minioService.objectExists(pending.getObjectKey())) {
                    minioService.delete(pending.getObjectKey());
                }
                pending.setStatus("CANCELLED");
                pendingUploadRepository.save(pending);
            } catch (Exception error) {
                log.warn("Could not clean expired temporary upload id={}", pending.getId(), error);
            }
        }
    }
}
