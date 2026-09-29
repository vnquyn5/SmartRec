package com.example.smartrec.service;

import java.time.Instant;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.example.smartrec.entity.MediaFile;
import com.example.smartrec.entity.MediaFileStatus;
import com.example.smartrec.exception.MinioOperationException;
import com.example.smartrec.repository.MediaFileRepository;
import com.example.smartrec.service.impl.TrashServiceImpl;

import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class TrashPurgeScheduler {
    private static final Logger log = LoggerFactory.getLogger(TrashPurgeScheduler.class);

    private final MediaFileRepository mediaFileRepository;
    private final TrashServiceImpl trashService;

    @Scheduled(cron = "${trash.purge-cron:0 0 2 * * *}")
    public void purgeExpiredTrash() {
        List<MediaFile> expiredFiles = mediaFileRepository.findExpiredTrash(
                MediaFileStatus.TRASHED, Instant.now());
        for (MediaFile mediaFile : expiredFiles) {
            try {
                trashService.deleteMinioThenDatabase(mediaFile);
                log.info("Purged expired media file. mediaFileId={}, objectKey={}",
                        mediaFile.getId(), mediaFile.getObject_key());
            } catch (MinioOperationException ex) {
                log.error("Could not purge expired media file from MinIO. mediaFileId={}, objectKey={}",
                        mediaFile.getId(), mediaFile.getObject_key(), ex);
            } catch (Exception ex) {
                log.error("Could not purge expired media file. mediaFileId={}, objectKey={}",
                        mediaFile.getId(), mediaFile.getObject_key(), ex);
            }
        }
    }
}
