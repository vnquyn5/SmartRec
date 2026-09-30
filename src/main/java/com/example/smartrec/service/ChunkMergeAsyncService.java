package com.example.smartrec.service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.task.TaskExecutor;
import org.springframework.stereotype.Service;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.enums.UploadSessionStatus;
import com.example.smartrec.model.UploadSession;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UploadSessionRepository;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class ChunkMergeAsyncService {
    private static final Logger log = LoggerFactory.getLogger(ChunkMergeAsyncService.class);

    private final TaskExecutor applicationTaskExecutor;
    private final MinioService minioService;
    private final UploadSessionRedisService uploadSessionRedisService;
    private final UploadSessionRepository uploadSessionRepository;
    private final MediaFileRepository mediaFileRepository;
    private final MeetingRepository meetingRepository;

    public void mergeAsync(MergeJob job) {
        applicationTaskExecutor.execute(() -> runMerge(job));
    }

    private void runMerge(MergeJob job) {
        long totalStartedAt = System.nanoTime();
        List<String> chunkObjectKeys = new ArrayList<>();
        try {
            Integer totalChunks = job.totalChunks();
            long stageStartedAt = System.nanoTime();
            for (int i = 0; i < totalChunks; i++) {
                chunkObjectKeys.add(job.sourceObjectPrefix() + i);
            }
            logMergeStage(job.uploadSessionId(), "build numeric source list", stageStartedAt);

            stageStartedAt = System.nanoTime();
            log.info(
                    "[chunked-merge] compose start uploadSessionId={}, sourceObjectPrefix={}, finalObjectKey={}, totalChunks={}, receivedChunks={}, redisUploadedChunkCount={}",
                    job.uploadSessionId(),
                    job.sourceObjectPrefix(),
                    job.finalObjectKey(),
                    totalChunks,
                    job.receivedChunks(),
                    job.redisUploadedChunkCount());
            minioService.composeObjects(job.finalObjectKey(), chunkObjectKeys);
            log.info("[chunked-merge] compose end uploadSessionId={}, finalObjectKey={}, elapsedMs={}",
                    job.uploadSessionId(),
                    job.finalObjectKey(),
                    elapsedMs(stageStartedAt));

            stageStartedAt = System.nanoTime();
            long finalObjectSize = minioService.getObjectSize(job.finalObjectKey());
            if (finalObjectSize <= 0) {
                throw new IllegalStateException("Final object has invalid size: " + finalObjectSize);
            }
            log.info("[chunked-merge] final object verified uploadSessionId={}, finalObjectKey={}, sizeBytes={}, elapsedMs={}",
                    job.uploadSessionId(),
                    job.finalObjectKey(),
                    finalObjectSize,
                    elapsedMs(stageStartedAt));

            stageStartedAt = System.nanoTime();
            UploadSession session = job.session();
            session.setStatus(UploadSessionStatus.COMPLETED);
            session.setReceivedChunks(totalChunks);
            if (session.getFileSize() == null || session.getFileSize() <= 0) {
                session.setFileSize(finalObjectSize);
            }
            uploadSessionRedisService.save(session);
            com.example.smartrec.entity.UploadSession persistentSession =
                    uploadSessionRepository.findById(job.uploadSessionId())
                            .orElseThrow(() -> new IllegalStateException(
                                    "Upload session not found: " + job.uploadSessionId()));
            persistentSession.setReceivedChunks(totalChunks);
            persistentSession.setStatus(UploadSessionStatus.COMPLETED);
            uploadSessionRepository.save(persistentSession);
            logMergeStage(job.uploadSessionId(), "update UploadSession COMPLETED", stageStartedAt);

            stageStartedAt = System.nanoTime();
            MediaFile mediaFile = findOrCreateMediaFile(job, finalObjectSize);
            logMergeStage(job.uploadSessionId(), "MediaFile save/reuse", stageStartedAt);

            stageStartedAt = System.nanoTime();
            findOrCreateMeeting(job, mediaFile);
            logMergeStage(job.uploadSessionId(), "Meeting save/reuse", stageStartedAt);

            stageStartedAt = System.nanoTime();
            cleanupChunks(job.uploadSessionId(), chunkObjectKeys);
            logMergeStage(job.uploadSessionId(), "cleanup chunks", stageStartedAt);

            log.info("[chunked-merge] completed uploadSessionId={}, finalObjectKey={}, elapsedMs={}",
                    job.uploadSessionId(),
                    job.finalObjectKey(),
                    elapsedMs(totalStartedAt));
        } catch (Exception e) {
            logMergeFailure(job, e, totalStartedAt);
            markMergeFailed(job.uploadSessionId(), job.session());
        }
    }

    private MediaFile findOrCreateMediaFile(MergeJob job, long finalObjectSize) {
        return mediaFileRepository.findByObjectKey(job.finalObjectKey())
                .orElseGet(() -> mediaFileRepository.save(
                        MediaFile.builder()
                                .workspace_id(job.userId())
                                .uploaded_by(job.userId())
                                .original_name(job.safeFileName())
                                .object_key(job.finalObjectKey())
                                .mime_type(detectMimeType(job.safeFileName()))
                                .file_size_bytes(finalObjectSize)
                                .status(MediaFileStatus.UPLOADED)
                                .build()));
    }

    private Meeting findOrCreateMeeting(MergeJob job, MediaFile mediaFile) {
        return meetingRepository.findByMediaFileId(mediaFile.getId())
                .orElseGet(() -> meetingRepository.save(
                        Meeting.builder()
                                .workspace_id(job.userId())
                                .media_file_id(mediaFile.getId())
                                .title(job.safeFileName())
                                .status(MeetingStatus.PENDING)
                                .build()));
    }

    private void cleanupChunks(UUID uploadSessionId, List<String> chunkObjectKeys) {
        int deletedCount = 0;
        for (String chunkObjectKey : chunkObjectKeys) {
            try {
                minioService.delete(chunkObjectKey);
                deletedCount++;
            } catch (Exception e) {
                log.warn("[chunked-merge] cleanup chunk failed uploadSessionId={}, objectKey={}",
                        uploadSessionId,
                        chunkObjectKey,
                        e);
            }
        }
        log.info("[chunked-merge] cleanup chunks finished uploadSessionId={}, requested={}, deleted={}",
                uploadSessionId,
                chunkObjectKeys.size(),
                deletedCount);
    }

    private void markMergeFailed(UUID uploadSessionId, UploadSession session) {
        try {
            session.setStatus(UploadSessionStatus.MERGE_FAILED);
            uploadSessionRedisService.save(session);
        } catch (Exception e) {
            log.warn("[chunked-merge] could not update Redis failure status uploadSessionId={}",
                    uploadSessionId,
                    e);
        }
        try {
            uploadSessionRepository.findById(uploadSessionId).ifPresent(persistentSession -> {
                persistentSession.setStatus(UploadSessionStatus.MERGE_FAILED);
                uploadSessionRepository.save(persistentSession);
            });
        } catch (Exception e) {
            log.warn("[chunked-merge] could not update PostgreSQL failure status uploadSessionId={}",
                    uploadSessionId,
                    e);
        }
    }

    private void logMergeFailure(MergeJob job, Exception e, long totalStartedAt) {
        log.error(
                "[chunked-merge] failed uploadSessionId={}, currentStatus={}, totalChunks={}, receivedChunks={}, redisUploadedChunkCount={}, sourceObjectPrefix={}, finalObjectKey={}, elapsedMs={}",
                job.uploadSessionId(),
                job.session().getStatus(),
                job.totalChunks(),
                job.receivedChunks(),
                job.redisUploadedChunkCount(),
                job.sourceObjectPrefix(),
                job.finalObjectKey(),
                elapsedMs(totalStartedAt),
                e);
    }

    private String detectMimeType(String fileName) {
        String extension = getExtension(fileName);
        return switch (extension) {
            case "mp3" -> "audio/mpeg";
            case "m4a" -> "audio/mp4";
            case "mp4" -> "video/mp4";
            case "mkv" -> "video/x-matroska";
            default -> "application/octet-stream";
        };
    }

    private String getExtension(String fileName) {
        int lastDot = fileName.lastIndexOf('.');
        if (lastDot == -1 || lastDot == fileName.length() - 1) {
            return "";
        }
        return fileName.substring(lastDot + 1).toLowerCase();
    }

    public static String sanitizeFileName(String fileName) {
        return fileName
                .replace("\\", "_")
                .replace("/", "_")
                .replace("..", "_")
                .replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    public static String sanitizeAccountName(String accountName) {
        if (accountName == null || accountName.isBlank()) {
            return "unknown_user";
        }
        return accountName.trim().replaceAll("[\\\\/:*?\"<>|]", "");
    }

    public static String buildUserObjectKey(String accountName, String fileName) {
        LocalDate now = LocalDate.now();
        return sanitizeAccountName(accountName)
                + "/"
                + String.format("%02d", now.getMonthValue())
                + "-"
                + now.getYear()
                + "/"
                + sanitizeFileName(fileName);
    }

    private void logMergeStage(UUID uploadSessionId, String stage, long startedAtNanos) {
        log.info("[chunked-merge] {} uploadSessionId={}, elapsedMs={}",
                stage,
                uploadSessionId,
                elapsedMs(startedAtNanos));
    }

    private long elapsedMs(long startedAtNanos) {
        return (System.nanoTime() - startedAtNanos) / 1_000_000;
    }

    public record MergeJob(
            UUID uploadSessionId,
            UUID userId,
            UploadSession session,
            String safeFileName,
            String sourceObjectPrefix,
            String finalObjectKey,
            Integer totalChunks,
            Integer receivedChunks,
            long redisUploadedChunkCount) {
    }
}
