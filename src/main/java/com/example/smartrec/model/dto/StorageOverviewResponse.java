package com.example.smartrec.model.dto;

import java.util.List;

public record StorageOverviewResponse(
        String bucketName,
        boolean minioConnected,
        boolean bucketHealthy,
        String minioWarning,
        long totalFiles,
        long totalSizeBytes,
        long uploadedFiles,
        long uploadedSizeBytes,
        long trashedFiles,
        long trashedSizeBytes,
        long uploadingFiles,
        long uploadingSizeBytes,
        long integrityFailedFiles,
        long integrityFailedSizeBytes,
        long expiredTrashCount,
        long expiredTrashBytes,
        long pendingUploadsCount,
        long stalePendingUploadsCount,
        long stalePendingUploadBytes,
        long activeUploadSessionsCount,
        long cancelledUploadSessionsCount,
        long minioObjectCount,
        long minioTotalSizeBytes,
        long orphanObjectCount,
        long orphanTotalSizeBytes,
        List<StatusBucket> statusBreakdown,
        List<MimeBucket> mimeBreakdown,
        List<DailyTrendBucket> recentDailyTrend
) {
    public record StatusBucket(String status, long count, long sizeBytes) {}

    public record MimeBucket(String category, long count, long sizeBytes) {}

    public record DailyTrendBucket(String date, long fileCount, long sizeBytes) {}
}

