package com.example.smartrec.service;

import java.time.LocalDate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.task.TaskExecutor;
import org.springframework.dao.DataIntegrityViolationException;
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
    public static final int STAGE_GROUP_SIZE = 100;
    private static final java.util.Set<String> STAGE_IN_FLIGHT = ConcurrentHashMap.newKeySet();
    private static final ConcurrentHashMap<String, ReentrantLock> STAGE_LOCKS = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, AtomicBoolean> STAGE_PENDING = new ConcurrentHashMap<>();

    private final TaskExecutor applicationTaskExecutor;
    private final MinioService minioService;
    private final UploadSessionRedisService uploadSessionRedisService;
    private final UploadSessionRepository uploadSessionRepository;
    private final MediaFileRepository mediaFileRepository;
    private final MeetingRepository meetingRepository;
    private final FileChecksumService fileChecksumService;
    public void mergeAsync(MergeJob job) {
        applicationTaskExecutor.execute(() -> runMerge(job));
    }

    /** Enqueue lightweight session work without making the caller wait for it. */
    public void executeAsync(Runnable task) {
        applicationTaskExecutor.execute(task);
    }

    public void stageChunkGroupAsync(UUID uploadSessionId, int totalChunks, int chunkIndex) {
        int groupIndex = chunkIndex / STAGE_GROUP_SIZE;
        int start = groupIndex * STAGE_GROUP_SIZE;
        int end = Math.min(start + STAGE_GROUP_SIZE, totalChunks);
        String lockKey = uploadSessionId + ":" + groupIndex;
        ReentrantLock stageLock = STAGE_LOCKS.computeIfAbsent(lockKey, ignored -> new ReentrantLock());
        AtomicBoolean pending = STAGE_PENDING.computeIfAbsent(lockKey, ignored -> new AtomicBoolean());
        pending.set(true);
        if (!STAGE_IN_FLIGHT.add(lockKey)) return;
        try {
            applicationTaskExecutor.execute(() -> {
            long startedAt = System.nanoTime();
            try {
                do {
                    pending.set(false);
                    try {
                        if (start >= end || !uploadSessionRedisService.hasUploadedChunkRange(uploadSessionId, start, end)) continue;
                        stageLock.lock();
                        try {
                            UploadSession currentSession = uploadSessionRedisService.get(uploadSessionId);
                            if (currentSession.getStatus() == UploadSessionStatus.MERGING
                                    || currentSession.getStatus() == UploadSessionStatus.COMPLETED
                                    || currentSession.getStatus() == UploadSessionStatus.MERGE_FAILED) continue;
                            String stageKey = stagedObjectKey(uploadSessionId, groupIndex);
                            long expectedSize = expectedStageSize(currentSession, start, end);
                            if (isValidStagedObject(stageKey, expectedSize)) continue;
                            composeStage(currentSession, groupIndex, start, end, "upload");
                        } finally {
                            stageLock.unlock();
                        }
                    } catch (Exception e) {
                        log.warn("[chunked-merge] staged group failed uploadSessionId={}, groupIndex={}, elapsedMs={}",
                                uploadSessionId, groupIndex, elapsedMs(startedAt), e);
                    }
                } while (pending.get());
            } finally {
                STAGE_IN_FLIGHT.remove(lockKey);
                if (pending.get()) stageChunkGroupAsync(uploadSessionId, totalChunks, chunkIndex);
            }
            });
        } catch (Exception e) {
            STAGE_IN_FLIGHT.remove(lockKey);
            log.warn("[chunked-merge] could not schedule staged group uploadSessionId={}, groupIndex={}",
                    uploadSessionId, groupIndex, e);
        }
    }

    private void runMerge(MergeJob job) {
        long totalStartedAt = job.finalizationStartedAtNanos();
        long composeMs = 0;
        long finalComposeMs = 0;
        long verifyMs = 0;
        long sha256Ms = 0;
        long duplicateMs = 0;
        long mediaFileSaveMs = 0;
        long statusMs = 0;
        long meetingMs = 0;
        long cleanupMs = 0;
        MergeMeasurements measurements = new MergeMeasurements();
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
            List<String> stagedSources = composeStagedGroups(job, totalChunks, measurements);
            long finalComposeStartedAt = System.nanoTime();
            minioService.composeObjects(job.finalObjectKey(), stagedSources);
            finalComposeMs = elapsedMs(finalComposeStartedAt);
            composeMs = elapsedMs(stageStartedAt);
            log.info("[chunked-merge] compose end uploadSessionId={}, finalObjectKey={}, elapsedMs={}",
                    job.uploadSessionId(),
                    job.finalObjectKey(),
                    composeMs);

            stageStartedAt = System.nanoTime();
            long finalObjectSize = minioService.getObjectSize(job.finalObjectKey());
            if (finalObjectSize <= 0 || (job.session().getFileSize() != null
                    && job.session().getFileSize() > 0
                    && finalObjectSize != job.session().getFileSize())) {
                throw new IllegalStateException("Final object has invalid size: " + finalObjectSize);
            }
            verifyMs = elapsedMs(stageStartedAt);
            log.info("[chunked-merge] final object verified uploadSessionId={}, finalObjectKey={}, sizeBytes={}, elapsedMs={}",
                    job.uploadSessionId(),
                    job.finalObjectKey(),
                    finalObjectSize,
                    verifyMs);

            String checksumSha256 = job.clientChecksumSha256();
            if (checksumSha256 == null || checksumSha256.isBlank()) {
                stageStartedAt = System.nanoTime();
                checksumSha256 = fileChecksumService.calculateSha256(job.finalObjectKey());
                sha256Ms = elapsedMs(stageStartedAt);
                log.info("[chunked-merge] server checksum calculated uploadSessionId={}, finalObjectKey={}, elapsedMs={}",
                        job.uploadSessionId(), job.finalObjectKey(), sha256Ms);
            } else {
                // The client digest was computed in a worker during chunk PUTs.
                // It is checked asynchronously after the final object is saved.
                log.info("[chunked-merge] client checksum available uploadSessionId={}, serverStreamDeferred=true",
                        job.uploadSessionId());
            }

            stageStartedAt = System.nanoTime();
            MediaFile mediaFile = findOrCreateMediaFile(job, finalObjectSize, checksumSha256, measurements);
            // The duplicate lookup and persistence timings are measured inside
            // findOrCreateMediaFile so they remain separate in the summary.
            duplicateMs += measurements.duplicateMs;
            mediaFileSaveMs = measurements.mediaFileSaveMs;
            logMergeStage(job.uploadSessionId(), "MediaFile duplicate/save", stageStartedAt);

            stageStartedAt = System.nanoTime();
            findOrCreateMeeting(job, mediaFile);
            meetingMs = elapsedMs(stageStartedAt);
            logMergeStage(job.uploadSessionId(), "Meeting save/reuse", stageStartedAt);

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
            statusMs = elapsedMs(stageStartedAt);
            logMergeStage(job.uploadSessionId(), "update UploadSession COMPLETED", stageStartedAt);

            stageStartedAt = System.nanoTime();
            List<String> cleanupKeys = new ArrayList<>(chunkObjectKeys);
            cleanupKeys.addAll(stagedObjectKeys(job.uploadSessionId(), totalChunks));
            cleanupChunks(job.uploadSessionId(), cleanupKeys);
            cleanupMs = elapsedMs(stageStartedAt);
            for (int groupIndex = 0; groupIndex < stagedObjectKeys(job.uploadSessionId(), totalChunks).size(); groupIndex++) {
                String lockKey = job.uploadSessionId() + ":" + groupIndex;
                STAGE_IN_FLIGHT.remove(lockKey);
                STAGE_LOCKS.remove(lockKey);
                STAGE_PENDING.remove(lockKey);
            }
            logMergeStage(job.uploadSessionId(), "cleanup chunks", stageStartedAt);

            long totalMergeMs = elapsedMs(totalStartedAt);
            log.info("[finalization] { uploadSessionId={}, totalChunks={}, stageCount={}, stagesAlreadyReady={}, stagesMissing={}, stagesBuiltDuringFinalization={}, waitForStageMs={}, finalComposeMs={}, verifyMs={}, sha256Ms={}, databaseMs={}, cleanupMs={}, totalMs={} }",
                    job.uploadSessionId(), totalChunks, stagedSources.size(), measurements.stagesAlreadyReady,
                    measurements.stagesMissing, measurements.stagesBuiltDuringFinalization, measurements.waitForStageMs,
                    finalComposeMs, verifyMs, sha256Ms, duplicateMs + mediaFileSaveMs + meetingMs + statusMs, cleanupMs, totalMergeMs);
            log.info(
                    "[chunked-merge] summary uploadSessionId={}, fileSize={}, totalChunks={}, composeMs={}, composePct={}, verifyMs={}, sha256Ms={}, sha256Pct={}, durationProbeMs={}, duplicateMs={}, mediaFileSaveMs={}, meetingSaveMs={}, statusMs={}, cleanupMs={}, cleanupPct={}, totalMergeMs={}",
                    job.uploadSessionId(),
                    finalObjectSize,
                    totalChunks,
                    composeMs,
                    percentage(composeMs, totalMergeMs),
                    verifyMs,
                    sha256Ms,
                    percentage(sha256Ms, totalMergeMs),
                    0,
                    duplicateMs,
                    mediaFileSaveMs,
                    meetingMs,
                    statusMs,
                    cleanupMs,
                    percentage(cleanupMs, totalMergeMs),
                    totalMergeMs);
            log.info("[chunked-merge] completed uploadSessionId={}, finalObjectKey={}, elapsedMs={}",
                    job.uploadSessionId(),
                    job.finalObjectKey(),
                    totalMergeMs);
            if (job.clientChecksumSha256() != null && !job.clientChecksumSha256().isBlank()
                    && job.finalObjectKey().equals(mediaFile.getObject_key())) {
                String expectedChecksum = job.clientChecksumSha256();
                try {
                    applicationTaskExecutor.execute(() -> verifyClientChecksumAsync(
                            job.uploadSessionId(), job.finalObjectKey(), expectedChecksum));
                } catch (Exception schedulingError) {
                    log.error("[chunked-merge] completed; checksum verification scheduling failed uploadSessionId={}",
                            job.uploadSessionId(), schedulingError);
                }
            }
        } catch (Exception e) {
            logMergeFailure(job, e, totalStartedAt);
            markMergeFailed(job.uploadSessionId(), job.session());
        }
    }

    private void verifyClientChecksumAsync(UUID uploadSessionId, String objectKey, String clientChecksum) {
        long startedAt = System.nanoTime();
        try {
            String serverChecksum = fileChecksumService.calculateSha256(objectKey);
            MediaFile currentMediaFile = mediaFileRepository.findByObjectKey(objectKey).orElse(null);
            if (currentMediaFile == null) return;
            List<MediaFile> duplicates = mediaFileRepository.findActiveByUserAndChecksumSha256ExcludingId(
                    currentMediaFile.getUploaded_by(), serverChecksum, currentMediaFile.getId());
            if (serverChecksum.equalsIgnoreCase(clientChecksum) && duplicates.isEmpty()) {
                if (currentMediaFile.getChecksumSha256() == null) {
                    currentMediaFile.setChecksumSha256(serverChecksum);
                    mediaFileRepository.save(currentMediaFile);
                }
                log.info("[chunked-merge] background checksum verified uploadSessionId={}, objectKey={}, backgroundSha256Ms={}",
                        uploadSessionId, objectKey, elapsedMs(startedAt));
                return;
            }
            markIntegrityFailed(objectKey, "checksum mismatch or duplicate race", serverChecksum,
                    duplicates.isEmpty() ? null : duplicates.get(0).getObject_key());
        } catch (Exception e) {
            markIntegrityFailed(objectKey, "checksum verification failed", null, null);
            log.error("[chunked-merge] background checksum verification failed uploadSessionId={}, objectKey={}, backgroundSha256Ms={}",
                    uploadSessionId, objectKey, elapsedMs(startedAt), e);
        }
    }

    private void markIntegrityFailed(String objectKey, String reason, String serverChecksum, String duplicateObjectKey) {
        mediaFileRepository.findByObjectKey(objectKey).ifPresent(mediaFile -> {
            mediaFile.setChecksumSha256(null);
            mediaFile.setQuickFingerprint(null);
            mediaFile.setStatus(MediaFileStatus.INTEGRITY_FAILED);
            mediaFileRepository.save(mediaFile);
            meetingRepository.findByMediaFileId(mediaFile.getId()).ifPresent(meeting -> {
                meeting.setStatus(MeetingStatus.FAILED);
                meetingRepository.save(meeting);
            });
            if (duplicateObjectKey != null && !duplicateObjectKey.equals(objectKey)) {
                deleteDuplicateFinalObject(objectKey, duplicateObjectKey);
            }
            log.error("[chunked-merge] integrity failure objectKey={}, mediaFileId={}, reason={}, serverChecksum={}",
                    objectKey, mediaFile.getId(), reason, serverChecksum);
        });
    }

    private List<String> composeStagedGroups(MergeJob job, int totalChunks, MergeMeasurements measurements) throws Exception {
        List<String> stageKeys = stagedObjectKeys(job.uploadSessionId(), totalChunks);
        for (int groupIndex = 0; groupIndex < stageKeys.size(); groupIndex++) {
            int start = groupIndex * STAGE_GROUP_SIZE;
            int end = Math.min(start + STAGE_GROUP_SIZE, totalChunks);
            if (isValidStagedObject(stageKeys.get(groupIndex), expectedStageSize(job.session(), start, end))) {
                measurements.stagesAlreadyReady++;
            }
        }
        measurements.stagesMissing = stageKeys.size() - measurements.stagesAlreadyReady;
        for (int groupIndex = 0; groupIndex < stageKeys.size(); groupIndex++) {
            String stageKey = stageKeys.get(groupIndex);
            String lockKey = job.uploadSessionId() + ":" + groupIndex;
            ReentrantLock stageLock = STAGE_LOCKS.computeIfAbsent(lockKey, ignored -> new ReentrantLock());
            long waitStartedAt = System.nanoTime();
            boolean acquired = stageLock.tryLock(30, TimeUnit.SECONDS);
            measurements.waitForStageMs += elapsedMs(waitStartedAt);
            if (!acquired) throw new IllegalStateException("Timed out waiting for stage " + groupIndex);
            try {
                int start = groupIndex * STAGE_GROUP_SIZE;
                int end = Math.min(start + STAGE_GROUP_SIZE, totalChunks);
                long expectedSize = expectedStageSize(job.session(), start, end);
                if (isValidStagedObject(stageKey, expectedSize)) continue;
                composeStage(job.session(), groupIndex, start, end, "finalization-fallback");
                measurements.stagesBuiltDuringFinalization++;
            } finally {
                stageLock.unlock();
            }
        }
        return stageKeys;
    }

    private void composeStage(UploadSession session, int groupIndex, int start, int end, String trigger) throws Exception {
        UUID sessionId = session.getUploadSessionId();
        long uploadedCount = uploadSessionRedisService.uploadedChunkCount(sessionId);
        Instant startedAt = Instant.now();
        long composeStartedAt = System.nanoTime();
        boolean success = false;
        log.info("[stage-compose] start uploadSessionId={} groupIndex={} firstChunk={} lastChunk={} uploadedCountAtStart={} startedAt={} trigger={} thread={}",
                sessionId, groupIndex, start, end - 1, uploadedCount, startedAt, trigger, Thread.currentThread().getName());
        try {
            minioService.composeObjects(stagedObjectKey(sessionId, groupIndex), chunkKeys(sessionId, start, end));
            success = true;
        } finally {
            log.info("[stage-compose] { uploadSessionId={}, groupIndex={}, firstChunk={}, lastChunk={}, uploadedCountAtStart={}, startedAt={}, composeMs={}, success={}, trigger={} }",
                    sessionId, groupIndex, start, end - 1, uploadedCount, startedAt, elapsedMs(composeStartedAt), success, trigger);
        }
    }

    private long expectedStageSize(UploadSession session, int startChunk, int endChunk) {
        if (session.getFileSize() == null || session.getChunkSize() == null) return -1;
        long startBytes = startChunk * session.getChunkSize();
        long endBytes = Math.min(session.getFileSize(), endChunk * session.getChunkSize());
        return Math.max(0, endBytes - startBytes);
    }

    private boolean isValidStagedObject(String objectKey, long expectedSize) {
        try {
            long actualSize = minioService.getObjectSize(objectKey);
            return expectedSize <= 0 || actualSize == expectedSize;
        } catch (Exception e) {
            return false;
        }
    }

    private List<String> stagedObjectKeys(UUID uploadSessionId, int totalChunks) {
        int groupCount = (totalChunks + STAGE_GROUP_SIZE - 1) / STAGE_GROUP_SIZE;
        List<String> keys = new ArrayList<>(groupCount);
        for (int groupIndex = 0; groupIndex < groupCount; groupIndex++) {
            keys.add(stagedObjectKey(uploadSessionId, groupIndex));
        }
        return keys;
    }

    private String stagedObjectKey(UUID uploadSessionId, int groupIndex) {
        return "tmp/" + uploadSessionId + "/staged/stage_" + String.format("%03d", groupIndex);
    }

    private List<String> chunkKeys(UUID uploadSessionId, int startInclusive, int endExclusive) {
        List<String> keys = new ArrayList<>(endExclusive - startInclusive);
        for (int index = startInclusive; index < endExclusive; index++) {
            keys.add("tmp/" + uploadSessionId + "/chunk_" + index);
        }
        return keys;
    }

    private MediaFile findOrCreateMediaFile(
            MergeJob job,
            long finalObjectSize,
            String checksumSha256,
            MergeMeasurements measurements) {
        long duplicateStartedAt = System.nanoTime();
        List<MediaFile> checksumDuplicates = mediaFileRepository.findActiveByUserAndChecksumSha256(
                job.userId(),
                checksumSha256);
        measurements.duplicateMs = elapsedMs(duplicateStartedAt);
        if (!checksumDuplicates.isEmpty()) {
            if (job.clientChecksumSha256() != null && !job.clientChecksumSha256().isBlank()) {
                // A client digest alone must not cause deletion/reuse of another
                // object. Keep this record unverified until background SHA resolves it.
                long saveStartedAt = System.nanoTime();
                try {
                    return saveMediaFile(job, finalObjectSize, null);
                } finally {
                    measurements.mediaFileSaveMs = elapsedMs(saveStartedAt);
                }
            }
            log.info("[chunked-merge] duplicate checksum found uploadSessionId={}, existingMediaFileId={}, existingFileName={}",
                    job.uploadSessionId(),
                    checksumDuplicates.get(0).getId(),
                    checksumDuplicates.get(0).getOriginal_name());
            deleteDuplicateFinalObject(job.finalObjectKey(), checksumDuplicates.get(0).getObject_key());
            return checksumDuplicates.get(0);
        }

        var existing = mediaFileRepository.findByObjectKey(job.finalObjectKey());
        if (existing.isPresent()) {
            return existing.get();
        }
        long saveStartedAt = System.nanoTime();
        try {
            return saveMediaFile(job, finalObjectSize, checksumSha256);
        } finally {
            measurements.mediaFileSaveMs = elapsedMs(saveStartedAt);
        }
    }

    private static final class MergeMeasurements {
        private long duplicateMs;
        private long mediaFileSaveMs;
        private int stagesAlreadyReady;
        private int stagesMissing;
        private int stagesBuiltDuringFinalization;
        private long waitForStageMs;
    }

    private MediaFile saveMediaFile(MergeJob job, long finalObjectSize, String checksumSha256) {
        try {
            return mediaFileRepository.save(
                    MediaFile.builder()
                            .workspace_id(job.userId())
                            .uploaded_by(job.userId())
                            .original_name(job.safeFileName())
                            .object_key(job.finalObjectKey())
                            .mime_type(detectMimeType(job.safeFileName()))
                            .file_size_bytes(finalObjectSize)
                            .checksumSha256(checksumSha256)
                            .quickFingerprint(job.quickFingerprint())
                            .fingerprintVersion(job.quickFingerprint() == null ? null : 2)
                            .status(MediaFileStatus.UPLOADED)
                            .build());
        } catch (DataIntegrityViolationException e) {
            if (checksumSha256 != null && job.clientChecksumSha256() != null && !job.clientChecksumSha256().isBlank()) {
                return saveMediaFile(job, finalObjectSize, null);
            }
            List<MediaFile> checksumDuplicates = mediaFileRepository.findActiveByUserAndChecksumSha256(
                    job.userId(),
                    checksumSha256);
            if (!checksumDuplicates.isEmpty()) {
                deleteDuplicateFinalObject(job.finalObjectKey(), checksumDuplicates.get(0).getObject_key());
                return checksumDuplicates.get(0);
            }
            throw e;
        }
    }

    private void deleteDuplicateFinalObject(String finalObjectKey, String existingObjectKey) {
        if (finalObjectKey == null || finalObjectKey.equals(existingObjectKey)) {
            return;
        }
        try {
            minioService.delete(finalObjectKey);
        } catch (Exception e) {
            log.warn("[chunked-merge] could not delete duplicate final object finalObjectKey={}", finalObjectKey, e);
        }
    }

    private Meeting findOrCreateMeeting(MergeJob job, MediaFile mediaFile) {
        return meetingRepository.findByMediaFileId(mediaFile.getId())
                .orElseGet(() -> meetingRepository.save(
                        Meeting.builder()
                                .workspace_id(job.userId())
                                .media_file_id(mediaFile.getId())
                                .title(job.safeFileName())
                                .status(MeetingStatus.UNPROCESSED)
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

    private double percentage(long stageMs, long totalMs) {
        return totalMs <= 0 ? 0 : Math.round(stageMs * 10000.0 / totalMs) / 100.0;
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
            long redisUploadedChunkCount,
            String quickFingerprint,
            String clientChecksumSha256,
            long finalizationStartedAtNanos) {
    }
}
