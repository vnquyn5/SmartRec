import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_ALERT_CATEGORY,
  STORAGE_ALERT_SEVERITY,
  evaluateOrphanAndWasteMetrics,
  evaluateStorageGrowthVelocity,
  evaluateStorageHealthAlerts,
} from './storageAlertEvaluator.js';

const MB = 1024 * 1024;
const GB = 1024 * MB;

function buildDailyTrend({ prev7DailyMb = 20, last7DailyMb = 20 } = {}) {
  const days = [];
  for (let i = 1; i <= 7; i += 1) {
    days.push({
      date: `2026-11-${String(i).padStart(2, '0')}`,
      fileCount: 2,
      sizeBytes: prev7DailyMb * MB,
    });
  }
  for (let i = 8; i <= 14; i += 1) {
    days.push({
      date: `2026-11-${String(i).padStart(2, '0')}`,
      fileCount: 3,
      sizeBytes: last7DailyMb * MB,
    });
  }
  return days;
}

function createOverview(overrides = {}) {
  return {
    bucketName: 'smartrec-media',
    minioConnected: true,
    bucketHealthy: true,
    minioWarning: null,
    totalFiles: 12,
    totalSizeBytes: 800 * MB,
    uploadedFiles: 10,
    uploadedSizeBytes: 750 * MB,
    trashedFiles: 2,
    trashedSizeBytes: 50 * MB,
    uploadingFiles: 0,
    uploadingSizeBytes: 0,
    integrityFailedFiles: 0,
    integrityFailedSizeBytes: 0,
    expiredTrashCount: 0,
    expiredTrashBytes: 0,
    stalePendingUploadsCount: 0,
    stalePendingUploadBytes: 0,
    cancelledUploadSessionsCount: 0,
    minioObjectCount: 12,
    minioTotalSizeBytes: 800 * MB,
    orphanObjectCount: 0,
    orphanTotalSizeBytes: 0,
    recentDailyTrend: buildDailyTrend({ prev7DailyMb: 20, last7DailyMb: 22 }),
    ...overrides,
  };
}

test('TC01: Missing or empty overview returns UNVERIFIED with zero fabricated growth/orphan numbers (BR03)', () => {
  const report = evaluateStorageHealthAlerts({ overview: null });
  assert.equal(report.status, STORAGE_ALERT_SEVERITY.UNVERIFIED);
  assert.equal(report.verified, false);
  assert.equal(report.autoPurgeAllowed, false);
  assert.equal(report.capacity.capacityUsagePct, null);
  assert.equal(report.orphanMetrics.orphanObjectCount, null);
  assert.equal(report.growth.avgDailyGrowthBytes, null);
  assert.equal(report.alerts.length, 1);
  assert.equal(report.alerts[0].severity, STORAGE_ALERT_SEVERITY.UNVERIFIED);
});

test('TC02: Growth velocity compares last 7d against previous 7d baseline and estimates days to quota (BR01, Mục 4.1)', () => {
  const trend = buildDailyTrend({ prev7DailyMb: 20, last7DailyMb: 40 });
  const growth = evaluateStorageGrowthVelocity(trend, {
    currentBytes: 1 * GB,
    quotaBytes: 2 * GB,
  });

  assert.equal(growth.verified, true);
  assert.equal(growth.trendDays, 14);
  assert.equal(growth.prev7dBytes, 140 * MB);
  assert.equal(growth.last7dBytes, 280 * MB);
  assert.equal(growth.avgDailyGrowthBytes, 40 * MB);
  assert.equal(growth.baselineComparable, true);
  assert.equal(growth.weekOverWeekGrowthPct, 100);
  assert.equal(growth.estimatedDaysToQuota, Math.ceil((1 * GB) / (40 * MB)));

  const emptyGrowth = evaluateStorageGrowthVelocity([]);
  assert.equal(emptyGrowth.status, STORAGE_ALERT_SEVERITY.UNVERIFIED);
  assert.equal(emptyGrowth.weekOverWeekGrowthPct, null);
});

test('TC03: Orphan metrics detect DB-vs-MinIO drift, orphan ratio, and trigger WARNING/CRITICAL alerts (BR01, Mục 4.1)', () => {
  const orphans = [
    { objectKey: 'tmp/session-1/chunk_0', sizeBytes: 40 * MB },
    { objectKey: 'tmp/session-1/chunk_1', sizeBytes: 40 * MB },
  ];
  const metrics = evaluateOrphanAndWasteMetrics(
    createOverview({
      totalSizeBytes: 720 * MB,
      minioTotalSizeBytes: 800 * MB,
      orphanObjectCount: 2,
      orphanTotalSizeBytes: 80 * MB,
      expiredTrashBytes: 20 * MB,
    }),
    orphans
  );

  assert.equal(metrics.verified, true);
  assert.equal(metrics.orphanObjectCount, 2);
  assert.equal(metrics.orphanTotalSizeBytes, 80 * MB);
  assert.equal(metrics.orphanRatioPct, 10);
  assert.equal(metrics.storageDriftBytes, 80 * MB);
  assert.equal(metrics.reclaimableBytes, 100 * MB);

  const report = evaluateStorageHealthAlerts({
    overview: createOverview({
      totalSizeBytes: 720 * MB,
      minioTotalSizeBytes: 800 * MB,
      orphanObjectCount: 2,
      orphanTotalSizeBytes: 80 * MB,
    }),
    orphans,
  });
  assert.equal(report.status, STORAGE_ALERT_SEVERITY.WARNING);
  assert.ok(report.alerts.some((a) => a.category === STORAGE_ALERT_CATEGORY.ORPHAN));
});

test('TC04: Capacity usage and MinIO connectivity/integrity failures trigger WARNING and CRITICAL alerts', () => {
  const warnReport = evaluateStorageHealthAlerts({
    overview: createOverview({
      totalSizeBytes: 4 * GB,
      minioTotalSizeBytes: 4 * GB,
    }),
    thresholds: { quotaBytes: 5 * GB },
  });
  assert.equal(warnReport.capacity.capacityUsagePct, 80);
  assert.equal(warnReport.status, STORAGE_ALERT_SEVERITY.WARNING);

  const critReport = evaluateStorageHealthAlerts({
    overview: createOverview({
      minioConnected: false,
      bucketHealthy: false,
      integrityFailedFiles: 2,
      totalSizeBytes: 4.8 * GB,
      minioTotalSizeBytes: 4.8 * GB,
    }),
    thresholds: { quotaBytes: 5 * GB },
  });
  assert.equal(critReport.status, STORAGE_ALERT_SEVERITY.CRITICAL);
  assert.ok(critReport.alerts.some((a) => a.category === STORAGE_ALERT_CATEGORY.CONNECTIVITY));
  assert.ok(critReport.alerts.some((a) => a.category === STORAGE_ALERT_CATEGORY.CAPACITY));
  assert.ok(critReport.alerts.some((a) => a.category === STORAGE_ALERT_CATEGORY.INTEGRITY));
});

test('TC05: Growth velocity spike over baseline triggers GROWTH alert', () => {
  const report = evaluateStorageHealthAlerts({
    overview: createOverview({
      recentDailyTrend: buildDailyTrend({ prev7DailyMb: 20, last7DailyMb: 35 }),
    }),
  });
  assert.equal(report.growth.weekOverWeekGrowthPct, 75);
  assert.equal(report.status, STORAGE_ALERT_SEVERITY.WARNING);
  assert.ok(report.alerts.some((a) => a.category === STORAGE_ALERT_CATEGORY.GROWTH));
});

test('TC06: Enforces ADMIN role for configuration, blocks auto destructive purge, and redacts secrets (BR02, TR02, Mục 4.2)', () => {
  const memberReport = evaluateStorageHealthAlerts({
    overview: createOverview({
      minioWarning: 'Connection failed for?X-Amz-Signature=supersecret999&token=tok123',
      orphanObjectCount: 1,
      orphanTotalSizeBytes: 60 * MB,
    }),
    orphans: [
      {
        objectKey: 'tmp/orphan.mp4?X-Amz-Signature=abc123secret',
        sizeBytes: 60 * MB,
      },
    ],
    user: { role: 'MEMBER' },
  });

  assert.equal(memberReport.isAdmin, false);
  assert.equal(memberReport.canConfigureThresholds, false);
  assert.equal(memberReport.canTriggerSafeCleanup, false);
  assert.equal(memberReport.autoPurgeAllowed, false);
  assert.ok(memberReport.alerts.every((a) => a.destructivePurgeBlocked === true));
  assert.ok(
    memberReport.alerts.every(
      (a) => !a.detail.includes('supersecret999') && !a.detail.includes('abc123secret')
    )
  );
});

test('TC07: Healthy storage below all thresholds evaluates as HEALTHY with zero alerts', () => {
  const report = evaluateStorageHealthAlerts({
    overview: createOverview(),
    user: { role: 'ADMIN' },
  });
  assert.equal(report.status, STORAGE_ALERT_SEVERITY.HEALTHY);
  assert.equal(report.alerts.length, 0);
  assert.equal(report.isAdmin, true);
  assert.equal(report.canConfigureThresholds, true);
});

