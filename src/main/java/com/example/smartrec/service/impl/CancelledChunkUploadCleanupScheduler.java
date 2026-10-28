package com.example.smartrec.service.impl;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.example.smartrec.enums.UploadSessionStatus;
import com.example.smartrec.repository.UploadSessionRepository;
import com.example.smartrec.service.ChunkMergeAsyncService;
import com.example.smartrec.service.UploadSessionRedisService;

import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class CancelledChunkUploadCleanupScheduler {
    private static final Logger log = LoggerFactory.getLogger(CancelledChunkUploadCleanupScheduler.class);

    private final UploadSessionRepository uploadSessionRepository;
    private final ChunkMergeAsyncService chunkMergeAsyncService;
    private final UploadSessionRedisService uploadSessionRedisService;

    @Scheduled(fixedDelayString = "${upload.pending-cleanup-interval-ms:3600000}")
    public void cleanupExpiredCancelledUploads() {
        var oldCancelledSessions = uploadSessionRepository
                .findTop100ByStatusAndUpdatedAtBeforeOrderByUpdatedAtAsc(
                        UploadSessionStatus.CANCELLED, Instant.now().minus(24, ChronoUnit.HOURS));
        for (var session : oldCancelledSessions) {
            try {
                if (!chunkMergeAsyncService.cleanupCancelledSession(session.getId(), session.getTotalChunks())) continue;
                uploadSessionRedisService.delete(session.getId());
                uploadSessionRepository.delete(session);
            } catch (Exception error) {
                log.warn("Could not clean cancelled upload session id={}", session.getId(), error);
            }
        }
    }
}
