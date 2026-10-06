package com.example.smartrec.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.example.smartrec.entity.*;
import com.example.smartrec.enums.UploadSessionStatus;
import com.example.smartrec.repository.*;
import com.example.smartrec.service.ChunkMergeAsyncService.MergeJob;

class ChunkStageComposeTest {
    private static final long CHUNK = 5L * 1024 * 1024;

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void buildsFiveStagesDuringUploadAndOnlyLastStageDuringFinalization(boolean duplicateCandidate) throws Exception {
        Queue<Runnable> queue = new ArrayDeque<>();
        TaskExecutor executor = queue::add;
        MinioService minio = mock(MinioService.class);
        UploadSessionRedisService redis = mock(UploadSessionRedisService.class);
        UploadSessionRepository sessions = mock(UploadSessionRepository.class);
        MediaFileRepository media = mock(MediaFileRepository.class);
        MeetingRepository meetings = mock(MeetingRepository.class);
        FileChecksumService checksums = mock(FileChecksumService.class);
        ChunkMergeAsyncService service = new ChunkMergeAsyncService(executor, minio, redis, sessions, media, meetings, checksums);
        UUID id = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        var session = com.example.smartrec.model.UploadSession.builder().uploadSessionId(id).userId(user)
                .totalChunks(553).chunkSize(CHUNK).fileSize(553 * CHUNK)
                .status(UploadSessionStatus.UPLOADING).build();
        AtomicInteger uploaded = new AtomicInteger();
        when(redis.get(id)).thenReturn(session);
        when(redis.uploadedChunkCount(id)).thenAnswer(inv -> (long) uploaded.get());
        when(redis.hasUploadedChunkRange(eq(id), anyInt(), anyInt()))
                .thenAnswer(inv -> uploaded.get() >= (int) inv.getArgument(2));
        Map<String, Long> objects = new HashMap<>();
        when(minio.getObjectSize(anyString())).thenAnswer(inv -> {
            Long size = objects.get(inv.getArgument(0));
            if (size == null) throw new IllegalStateException("object missing");
            return size;
        });
        doAnswer(inv -> {
            List<String> sources = inv.getArgument(1);
            long size = sources.stream().mapToLong(key -> key.contains("/chunk_") ? CHUNK : objects.get(key)).sum();
            objects.put(inv.getArgument(0), size);
            return null;
        }).when(minio).composeObjects(anyString(), anyList());
        Logger logger = (Logger) LoggerFactory.getLogger(ChunkMergeAsyncService.class);
        ListAppender<ILoggingEvent> logs = new ListAppender<>();
        logs.start();
        logger.addAppender(logs);
        try {
            for (int index = 0; index < 500; index++) {
                uploaded.incrementAndGet();
                service.stageChunkGroupAsync(id, 553, index);
                while (!queue.isEmpty()) queue.remove().run();
            }
            assertEquals(5, objects.size());
            for (int group = 0; group < 5; group++) {
                String key = "tmp/" + id + "/staged/stage_" + String.format("%03d", group);
                assertEquals(100 * CHUNK, objects.get(key));
                verify(minio, times(1)).composeObjects(eq(key), anyList());
                final int expectedCount = (group + 1) * 100;
                assertTrue(logs.list.stream().anyMatch(event -> event.getFormattedMessage().contains(
                        "uploadedCountAtStart=" + expectedCount + ",")));
            }
            // A repeated successful chunk must reuse its existing stage.
            service.stageChunkGroupAsync(id, 553, 99);
            while (!queue.isEmpty()) queue.remove().run();
            verify(minio, times(5)).composeObjects(anyString(), anyList());

            uploaded.set(553);
            session.setStatus(UploadSessionStatus.MERGING);
            var persistent = com.example.smartrec.entity.UploadSession.builder().id(id).status(UploadSessionStatus.MERGING).build();
            when(sessions.findById(id)).thenReturn(Optional.of(persistent));
            when(media.save(any())).thenAnswer(inv -> {
                MediaFile row = inv.getArgument(0);
                row.setId(UUID.randomUUID());
                if (duplicateCandidate) assertNull(row.getChecksumSha256());
                return row;
            });
            if (duplicateCandidate) {
                when(media.findActiveByUserAndChecksumSha256(user, "a".repeat(64))).thenReturn(List.of(
                        MediaFile.builder().id(UUID.randomUUID()).object_key("other-file.mp4").build()));
            }
            service.mergeAsync(new MergeJob(id, user, session, "large.mp4", "tmp/" + id + "/chunk_",
                    "final.mp4", 553, 553, 553, null, "a".repeat(64), System.nanoTime()));
            queue.remove().run(); // Leave background SHA queued until after COMPLETED.
            assertEquals(UploadSessionStatus.COMPLETED, session.getStatus());
            verifyNoInteractions(checksums);
            verify(minio, never()).delete("final.mp4");
            verify(minio, times(7)).composeObjects(anyString(), anyList());
            assertTrue(logs.list.stream().anyMatch(event -> event.getFormattedMessage().contains(
                    "stagesAlreadyReady=5, stagesMissing=1, stagesBuiltDuringFinalization=1")));
            assertEquals(1, queue.size());
        } finally {
            logger.detachAppender(logs);
            logs.stop();
        }
    }

    @Test
    void dispatchReturnsWhileComposeRunsOnExecutorAndCoalescesDuplicateTriggers() throws Exception {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setThreadNamePrefix("test-stage-");
        executor.initialize();
        MinioService minio = mock(MinioService.class);
        UploadSessionRedisService redis = mock(UploadSessionRedisService.class);
        UUID id = UUID.randomUUID();
        var session = com.example.smartrec.model.UploadSession.builder().uploadSessionId(id)
                .fileSize(553 * CHUNK).chunkSize(CHUNK).status(UploadSessionStatus.UPLOADING).build();
        when(redis.get(id)).thenReturn(session);
        when(redis.hasUploadedChunkRange(id, 0, 100)).thenReturn(true);
        when(redis.uploadedChunkCount(id)).thenReturn(100L);
        AtomicInteger composed = new AtomicInteger();
        when(minio.getObjectSize(anyString())).thenAnswer(inv -> {
            if (composed.get() == 0) throw new IllegalStateException("missing stage");
            return 100 * CHUNK;
        });
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(1);
        doAnswer(inv -> {
            assertTrue(Thread.currentThread().getName().startsWith("test-stage-"));
            entered.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            composed.incrementAndGet();
            finished.countDown();
            return null;
        }).when(minio).composeObjects(anyString(), anyList());
        ChunkMergeAsyncService service = new ChunkMergeAsyncService(executor, minio, redis,
                mock(UploadSessionRepository.class), mock(MediaFileRepository.class), mock(MeetingRepository.class), mock(FileChecksumService.class));
        try {
            service.stageChunkGroupAsync(id, 553, 99);
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            for (int index = 0; index < 10; index++) service.stageChunkGroupAsync(id, 553, 99);
            assertEquals(0, composed.get());
            release.countDown();
            assertTrue(finished.await(5, TimeUnit.SECONDS));
            verify(minio, times(1)).composeObjects(anyString(), anyList());
        } finally {
            release.countDown();
            executor.setWaitForTasksToCompleteOnShutdown(true);
            executor.setAwaitTerminationSeconds(5);
            executor.shutdown();
        }
    }
}
