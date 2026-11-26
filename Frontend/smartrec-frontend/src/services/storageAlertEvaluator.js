import { hasGovernanceAdminRole } from './loraPocGateEvaluator.js';
import { redactSensitiveObjectRef } from './artifactRetentionValidator.js';

export const STORAGE_ALERT_SEVERITY = Object.freeze({ // khai báo hằng số với các mức độ nghiêm trọng của cảnh báo 
  UNVERIFIED: 'UNVERIFIED',
  HEALTHY: 'HEALTHY',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
});

export const STORAGE_ALERT_CATEGORY = Object.freeze({ // khai báo hằng số với các loại cảnh báo lưu trữ 
  CONNECTIVITY: 'CONNECTIVITY',
  CAPACITY: 'CAPACITY',
  ORPHAN: 'ORPHAN', // file mồ côi orphan objects
  GROWTH: 'GROWTH', // tốc độ tăng trưởng
  INTEGRITY: 'INTEGRITY', // độ toàn vẹn của file
});

const MB = 1024 * 1024; // Tổng 1 MB = 1024 x 1024 bytes
const GB = 1024 * MB; // Tổng 1 GB = 1024 x 1024 x 1024 bytes 

export const DEFAULT_STORAGE_ALERT_THRESHOLDS = Object.freeze({ // khai báo hằng số với các ngưỡng cảnh báo lưu trữ
  quotaBytes: 5 * GB, // hạng mức bytes 5 GB = 5 x 1024 x 1024 x 1024 bytes 
  capacityWarningPct: 75, // ngưỡng cảnh báo 75% = 75/100 
  capacityCriticalPct: 90, // ngưỡng cảnh báo 90% = 90/100

  capacityCriticalPct: 90, // ngưỡng cảnh báo 90% = 90/100
  orphanWarningCount: 1, // ngưỡng cảnh báo 1 file
  orphanCriticalCount: 10, // ngưỡng cảnh báo 10 file
  orphanWarningBytes: 50 * MB, // ngưỡng cảnh báo 50 MB = 50 x 1024 x 1024 bytes 
  orphanCriticalBytes: 250 * MB, // ngưỡng cảnh báo 250 MB = 250 x 1024 x 1024 bytes
  orphanWarningRatioPct: 5, // ngưỡng cảnh báo 5% = 5/100 
  orphanCriticalRatioPct: 15, // ngưỡng cảnh báo 15% = 15/100
  growthWarningWoWPct: 50, // ngưỡng cảnh báo 50% = 50/100
  growthCriticalWoWPct: 100, // ngưỡng cảnh báo 100% = 100/100
  daysToFullWarning: 14, // ngưỡng cảnh báo 14 ngày
  daysToFullCritical: 7, // ngưỡng cảnh báo 7 ngày
}); ``

function toNonNegativeNumber(value, fallback = null) { // chức năng hàm chuyển đổi giá trị sang số không âm 
  if (value === null || value === undefined || value === '') return fallback; // nếu giá trị không null, undefined hoặc chuỗi rỗng thì trả về giá trị mặc định 
  const num = Number(value); // chuyển đổi giá trị sang số 
  return Number.isFinite(num) && num >= 0 ? num : fallback; // nếu số là số hữu hạn và số không âm thì trả về số, ngược lại thì trả về giá trị mặc định 
}

function roundTo(value, decimals = 1) { // chức năng hàm làm tròn giá trị với số thập phân 
  if (!Number.isFinite(value)) return null; // nếu giá trị không phải số hữu hạn thì trả về null 
  const factor = 10 ** decimals; // tính hệ số làm tròn 
  return Math.round(value * factor) / factor; // làm tròn giá trị và trả về 
}

export function normalizeAlertThresholds(raw = {}) { // chức năng hàm chuẩn hoá ngưỡng cảnh báo 
  const src = raw && typeof raw === 'object' ? raw : {}; // nếu raw là object thì gán cho src, ngược lại thì gán {} chuỗi rỗng
  const quotaBytes = // tổng hạn mức bytes là số không âm thì gán cho quotaBytes, ngược lại thì gán DEFAULT_STORAGE_ALERT_THRESHOLDS.quotaBytes 
    toNonNegativeNumber(src.quotaBytes, DEFAULT_STORAGE_ALERT_THRESHOLDS.quotaBytes) ||
    DEFAULT_STORAGE_ALERT_THRESHOLDS.quotaBytes; // tổng hạn mức bytes là số không âm thì gán cho quotaBytes, ngược lại thì gán DEFAULT_STORAGE_ALERT_THRESHOLDS.quotaBytes 

  const capacityWarningPct = Math.min( // tổng sức chứa cảnh báo
    99,
    Math.max(10, toNonNegativeNumber(src.capacityWarningPct, DEFAULT_STORAGE_ALERT_THRESHOLDS.capacityWarningPct))
  );// lấy ngưỡng % cảnh báo đầy kho (mặc định là 75%), và dùng cặp Math.max(10, ...) + Math.min(99, ...) để khóa cứng giá trị trong vùng an toàn từ 10% đến 99%, chống người dùng nhập số âm hoặc số vượt quá 100%.
  const capacityCriticalPct = Math.min( // hàm tổng sức chứa nghiêm trọng 
    100,
    Math.max(
      capacityWarningPct + 1,
      toNonNegativeNumber(src.capacityCriticalPct, DEFAULT_STORAGE_ALERT_THRESHOLDS.capacityCriticalPct) // nếu hàm toán max tối đa hóa giá trị từ tham số 2  
    )
  );

  return {
    quotaBytes: Math.max(100 * MB, quotaBytes), // quotaBytes: Math.max(100 * MB, quotaBytes) dùng để đặt mức sàn tối thiểu cho hạn mức dung lượng kho là 100 MB (không cho phép đặt hạn mức kho nhỏ hơn 100 MB).
    capacityWarningPct, // cảnh báo sức chứa file 
    capacityCriticalPct, // cảnh báo sức chứa file ở ngưỡng nghiêm trọng 
    orphanWarningCount: Math.max( // cảnh báo tổng số file mồ côi
      1,
      Math.floor(
        toNonNegativeNumber(src.orphanWarningCount, DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanWarningCount)
      )
    ),
    orphanCriticalCount: Math.max(
      2,
      Math.floor(
        toNonNegativeNumber(src.orphanCriticalCount, DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanCriticalCount)
      )
    ),
    orphanWarningBytes:
      toNonNegativeNumber(src.orphanWarningBytes, DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanWarningBytes) ||
      DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanWarningBytes,
    orphanCriticalBytes:
      toNonNegativeNumber(src.orphanCriticalBytes, DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanCriticalBytes) ||
      DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanCriticalBytes,
    orphanWarningRatioPct:
      toNonNegativeNumber(src.orphanWarningRatioPct, DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanWarningRatioPct) ||
      DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanWarningRatioPct,
    orphanCriticalRatioPct:
      toNonNegativeNumber(src.orphanCriticalRatioPct, DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanCriticalRatioPct) ||
      DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanCriticalRatioPct,
    growthWarningWoWPct:
      toNonNegativeNumber(src.growthWarningWoWPct, DEFAULT_STORAGE_ALERT_THRESHOLDS.growthWarningWoWPct) ||
      DEFAULT_STORAGE_ALERT_THRESHOLDS.growthWarningWoWPct,
    growthCriticalWoWPct:
      toNonNegativeNumber(src.growthCriticalWoWPct, DEFAULT_STORAGE_ALERT_THRESHOLDS.growthCriticalWoWPct) ||
      DEFAULT_STORAGE_ALERT_THRESHOLDS.growthCriticalWoWPct,
    daysToFullWarning:
      toNonNegativeNumber(src.daysToFullWarning, DEFAULT_STORAGE_ALERT_THRESHOLDS.daysToFullWarning) ||
      DEFAULT_STORAGE_ALERT_THRESHOLDS.daysToFullWarning,
    daysToFullCritical:
      toNonNegativeNumber(src.daysToFullCritical, DEFAULT_STORAGE_ALERT_THRESHOLDS.daysToFullCritical) ||
      DEFAULT_STORAGE_ALERT_THRESHOLDS.daysToFullCritical,
  };
}


export function evaluateStorageGrowthVelocity(
  recentDailyTrend,
  { currentBytes = 0, quotaBytes = DEFAULT_STORAGE_ALERT_THRESHOLDS.quotaBytes } = {}
) {
  if (!Array.isArray(recentDailyTrend) || recentDailyTrend.length === 0) {
    return {
      status: STORAGE_ALERT_SEVERITY.UNVERIFIED,
      verified: false,
      trendDays: 0,
      last7dBytes: null,
      last7dFiles: null,
      prev7dBytes: null,
      prev7dFiles: null,
      avgDailyGrowthBytes: null,
      avgDailyFiles: null,
      baselineComparable: false,
      weekOverWeekGrowthPct: null,
      weekOverWeekDeltaBytes: null,
      peakDailyBytes: null,
      peakDate: null,
      estimatedDaysToQuota: null,
      reason:
        'Chưa có chuỗi dữ liệu xu hướng theo ngày (recentDailyTrend) đủ căn cứ để tính tốc độ tăng trưởng (BR03).',
    };
  }

  const validPoints = recentDailyTrend
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.date === 'string' && entry.date.trim())
    .map((entry) => ({
      date: entry.date.trim(),
      sizeBytes: toNonNegativeNumber(entry.sizeBytes, 0),
      fileCount: Math.floor(toNonNegativeNumber(entry.fileCount, 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (validPoints.length === 0) {
    return {
      status: STORAGE_ALERT_SEVERITY.UNVERIFIED,
      verified: false,
      trendDays: 0,
      last7dBytes: null,
      last7dFiles: null,
      prev7dBytes: null,
      prev7dFiles: null,
      avgDailyGrowthBytes: null,
      avgDailyFiles: null,
      baselineComparable: false,
      weekOverWeekGrowthPct: null,
      weekOverWeekDeltaBytes: null,
      peakDailyBytes: null,
      peakDate: null,
      estimatedDaysToQuota: null,
      reason: 'Dữ liệu xu hướng ngày không hợp lệ — giữ trạng thái Chưa xác minh (BR03).',
    };
  }

  const recentWindow = validPoints.slice(-7);
  const prevWindow = validPoints.slice(Math.max(0, validPoints.length - 14), Math.max(0, validPoints.length - 7));

  const last7dBytes = recentWindow.reduce((sum, d) => sum + d.sizeBytes, 0);
  const last7dFiles = recentWindow.reduce((sum, d) => sum + d.fileCount, 0);
  const avgDailyGrowthBytes = Math.round(last7dBytes / recentWindow.length);
  const avgDailyFiles = roundTo(last7dFiles / recentWindow.length, 1);

  const prev7dBytes = prevWindow.length > 0 ? prevWindow.reduce((sum, d) => sum + d.sizeBytes, 0) : null;
  const prev7dFiles = prevWindow.length > 0 ? prevWindow.reduce((sum, d) => sum + d.fileCount, 0) : null;

  const baselineComparable = prevWindow.length >= 3 && prev7dBytes !== null && prev7dBytes > 0;
  const weekOverWeekDeltaBytes =
    prev7dBytes !== null ? last7dBytes - prev7dBytes : null;
  const weekOverWeekGrowthPct = baselineComparable
    ? roundTo(((last7dBytes - prev7dBytes) / prev7dBytes) * 100, 1)
    : null;

  let peakDailyBytes = 0;
  let peakDate = validPoints[0].date;
  for (const pt of validPoints) {
    if (pt.sizeBytes >= peakDailyBytes) {
      peakDailyBytes = pt.sizeBytes;
      peakDate = pt.date;
    }
  }

  const safeCurrentBytes = toNonNegativeNumber(currentBytes, 0);
  const safeQuotaBytes = toNonNegativeNumber(quotaBytes, DEFAULT_STORAGE_ALERT_THRESHOLDS.quotaBytes);
  let estimatedDaysToQuota = null;
  if (safeCurrentBytes >= safeQuotaBytes) {
    estimatedDaysToQuota = 0;
  } else if (avgDailyGrowthBytes > 0) {
    estimatedDaysToQuota = Math.ceil((safeQuotaBytes - safeCurrentBytes) / avgDailyGrowthBytes);
  }

  return {
    status: STORAGE_ALERT_SEVERITY.HEALTHY,
    verified: true,
    trendDays: validPoints.length,
    last7dBytes,
    last7dFiles,
    prev7dBytes,
    prev7dFiles,
    avgDailyGrowthBytes,
    avgDailyFiles,
    baselineComparable,
    weekOverWeekGrowthPct,
    weekOverWeekDeltaBytes,
    peakDailyBytes,
    peakDate,
    estimatedDaysToQuota,
    reason: null,
  };
}

export function evaluateOrphanAndWasteMetrics(overview, orphans = []) {
  if (!overview || typeof overview !== 'object') {
    return {
      verified: false,
      orphanObjectCount: null,
      orphanTotalSizeBytes: null,
      orphanRatioPct: null,
      reclaimableBytes: null,
      reclaimableCount: null,
      reclaimableRatioPct: null,
      storageDriftBytes: null,
      topOrphanKeys: [],
    };
  }

  const orphanList = Array.isArray(orphans) ? orphans : [];
  const listCount = orphanList.length;
  const listBytes = orphanList.reduce(
    (sum, item) => sum + toNonNegativeNumber(item?.sizeBytes, 0),
    0
  );

  const orphanObjectCount = Math.max(
    Math.floor(toNonNegativeNumber(overview.orphanObjectCount, 0)),
    listCount
  );
  const orphanTotalSizeBytes = Math.max(
    toNonNegativeNumber(overview.orphanTotalSizeBytes, 0),
    listBytes
  );

  const dbTotalSizeBytes = toNonNegativeNumber(overview.totalSizeBytes, 0);
  const minioTotalSizeBytes = Math.max(
    toNonNegativeNumber(overview.minioTotalSizeBytes, 0),
    dbTotalSizeBytes + orphanTotalSizeBytes
  );

  const expiredTrashBytes = toNonNegativeNumber(overview.expiredTrashBytes, 0);
  const stalePendingUploadBytes = toNonNegativeNumber(overview.stalePendingUploadBytes, 0);
  const expiredTrashCount = Math.floor(toNonNegativeNumber(overview.expiredTrashCount, 0));
  const stalePendingUploadsCount = Math.floor(
    toNonNegativeNumber(overview.stalePendingUploadsCount, 0)
  );
  const cancelledUploadSessionsCount = Math.floor(
    toNonNegativeNumber(overview.cancelledUploadSessionsCount, 0)
  );

  const reclaimableBytes =
    orphanTotalSizeBytes + expiredTrashBytes + stalePendingUploadBytes;
  const reclaimableCount =
    orphanObjectCount +
    expiredTrashCount +
    stalePendingUploadsCount +
    cancelledUploadSessionsCount;

  const denominatorBytes = minioTotalSizeBytes > 0 ? minioTotalSizeBytes : dbTotalSizeBytes;
  const orphanRatioPct =
    denominatorBytes > 0
      ? roundTo((orphanTotalSizeBytes / denominatorBytes) * 100, 1)
      : 0;
  const reclaimableRatioPct =
    denominatorBytes > 0
      ? roundTo((reclaimableBytes / denominatorBytes) * 100, 1)
      : 0;

  const storageDriftBytes = Math.max(0, minioTotalSizeBytes - dbTotalSizeBytes);

  const topOrphanKeys = orphanList
    .slice(0, 3)
    .map((item) => redactSensitiveObjectRef(item?.objectKey))
    .filter(Boolean);

  return {
    verified: true,
    orphanObjectCount,
    orphanTotalSizeBytes,
    orphanRatioPct,
    reclaimableBytes,
    reclaimableCount,
    reclaimableRatioPct,
    storageDriftBytes,
    topOrphanKeys,
  };
}


export function evaluateStorageHealthAlerts({
  overview = null,
  orphans = [],
  thresholds: rawThresholds = {},
  user = null,
} = {}) {
  const thresholds = normalizeAlertThresholds(rawThresholds);
  const isAdmin = hasGovernanceAdminRole(user);

  const hasValidOverview =
    Boolean(overview) &&
    typeof overview === 'object' &&
    (overview.totalSizeBytes !== undefined || overview.minioTotalSizeBytes !== undefined);

  if (!hasValidOverview) {
    const unverifiedGrowth = evaluateStorageGrowthVelocity(null);
    const unverifiedOrphans = evaluateOrphanAndWasteMetrics(null);
    return {
      status: STORAGE_ALERT_SEVERITY.UNVERIFIED,
      verified: false,
      bucketName: 'smartrec-media',
      isAdmin,
      canConfigureThresholds: isAdmin,
      canTriggerSafeCleanup: false,
      autoPurgeAllowed: false,
      thresholds,
      capacity: {
        verified: false,
        dbTotalSizeBytes: null,
        minioTotalSizeBytes: null,
        quotaBytes: thresholds.quotaBytes,
        capacityUsagePct: null,
      },
      orphanMetrics: unverifiedOrphans,
      growth: unverifiedGrowth,
      alerts: [
        {
          id: 'storage-unverified-input',
          category: STORAGE_ALERT_CATEGORY.CONNECTIVITY,
          severity: STORAGE_ALERT_SEVERITY.UNVERIFIED,
          title: 'Chưa xác minh dữ liệu giám sát kho lưu trữ (UNVERIFIED)',
          detail:
            'Chưa có dữ liệu tổng quan từ Storage API hoặc cấu trúc dữ liệu rỗng — hệ thống không tạo chỉ số tăng trưởng/cảnh báo giả (BR03).',
          recommendedAction: 'Kiểm tra kết nối Backend Storage API (/admin/storage/overview).',
          destructivePurgeBlocked: true,
        },
      ],
    };
  }

  const bucketName = redactSensitiveObjectRef(overview.bucketName) || 'smartrec-media';
  const orphanMetrics = evaluateOrphanAndWasteMetrics(overview, orphans);
  const dbTotalSizeBytes = toNonNegativeNumber(overview.totalSizeBytes, 0);
  const minioTotalSizeBytes = Math.max(
    toNonNegativeNumber(overview.minioTotalSizeBytes, 0),
    dbTotalSizeBytes + (orphanMetrics.orphanTotalSizeBytes || 0)
  );
  const effectiveUsedBytes = Math.max(minioTotalSizeBytes, dbTotalSizeBytes);
  const quotaBytes =
    toNonNegativeNumber(overview.quotaBytes, null) || thresholds.quotaBytes;
  const capacityUsagePct =
    quotaBytes > 0 ? roundTo((effectiveUsedBytes / quotaBytes) * 100, 1) : 0;

  const growth = evaluateStorageGrowthVelocity(overview.recentDailyTrend, {
    currentBytes: effectiveUsedBytes,
    quotaBytes,
  });

  const alerts = [];

  // 1. Connectivity & Bucket Health Alert
  const minioConnected = overview.minioConnected !== false;
  const bucketHealthy = overview.bucketHealthy !== false;
  if (!minioConnected || !bucketHealthy || overview.minioWarning) {
    const safeWarning = redactSensitiveObjectRef(overview.minioWarning);
    alerts.push({
      id: 'minio-connectivity-alert',
      category: STORAGE_ALERT_CATEGORY.CONNECTIVITY,
      severity:
        !minioConnected || !bucketHealthy
          ? STORAGE_ALERT_SEVERITY.CRITICAL
          : STORAGE_ALERT_SEVERITY.WARNING,
      title: !minioConnected || !bucketHealthy
        ? 'Kết nối MinIO Bucket gián đoạn hoặc Degraded'
        : 'Cảnh báo đồng bộ MinIO Bucket',
      detail:
        safeWarning ||
        'Không thể xác nhận trạng thái healthy của bucket lưu trữ đối tượng.',
      recommendedAction:
        'Kiểm tra dịch vụ MinIO và đối chiếu trạng thái bucket trước khi chạy tác vụ dọn dẹp.',
      destructivePurgeBlocked: true,
    });
  }

  // 2. Capacity Usage Alert
  if (capacityUsagePct >= thresholds.capacityCriticalPct) {
    alerts.push({
      id: 'capacity-critical-alert',
      category: STORAGE_ALERT_CATEGORY.CAPACITY,
      severity: STORAGE_ALERT_SEVERITY.CRITICAL,
      title: `Dung lượng lưu trữ vượt ngưỡng nghiêm trọng (${capacityUsagePct}%)`,
      detail: `Đang sử dụng ${capacityUsagePct}% hạn mức giám sát (ngưỡng CRITICAL: ${thresholds.capacityCriticalPct}%).`,
      recommendedAction:
        'Thu hồi orphan objects và trash đã quá hạn purge_at theo đúng retention policy.',
      destructivePurgeBlocked: true,
    });
  } else if (capacityUsagePct >= thresholds.capacityWarningPct) {
    alerts.push({
      id: 'capacity-warning-alert',
      category: STORAGE_ALERT_CATEGORY.CAPACITY,
      severity: STORAGE_ALERT_SEVERITY.WARNING,
      title: `Dung lượng lưu trữ tiệm cận ngưỡng cảnh báo (${capacityUsagePct}%)`,
      detail: `Đang sử dụng ${capacityUsagePct}% hạn mức giám sát (ngưỡng WARNING: ${thresholds.capacityWarningPct}%).`,
      recommendedAction:
        'Theo dõi các tệp dung lượng lớn và lên lịch dọn rác định kỳ.',
      destructivePurgeBlocked: true,
    });
  }

  // 3. Orphan Objects & Unreferenced Storage Drift Alert
  const {
    orphanObjectCount,
    orphanTotalSizeBytes,
    orphanRatioPct,
    topOrphanKeys,
  } = orphanMetrics;

  const isOrphanCritical =
    orphanObjectCount >= thresholds.orphanCriticalCount ||
    orphanTotalSizeBytes >= thresholds.orphanCriticalBytes ||
    orphanRatioPct >= thresholds.orphanCriticalRatioPct;

  const isOrphanWarning =
    !isOrphanCritical &&
    (orphanObjectCount >= thresholds.orphanWarningCount ||
      orphanTotalSizeBytes >= thresholds.orphanWarningBytes ||
      orphanRatioPct >= thresholds.orphanWarningRatioPct);

  if (isOrphanCritical || isOrphanWarning) {
    const sampleKeysText =
      topOrphanKeys.length > 0 ? ` (ví dụ: ${topOrphanKeys.join(', ')})` : '';
    alerts.push({
      id: isOrphanCritical ? 'orphan-critical-alert' : 'orphan-warning-alert',
      category: STORAGE_ALERT_CATEGORY.ORPHAN,
      severity: isOrphanCritical
        ? STORAGE_ALERT_SEVERITY.CRITICAL
        : STORAGE_ALERT_SEVERITY.WARNING,
      title: isOrphanCritical
        ? `Phát hiện lượng lớn Orphan Objects trên MinIO (${orphanObjectCount} objects · ${orphanRatioPct}%)`
        : `Phát hiện Orphan Objects chưa đối soát (${orphanObjectCount} objects · ${orphanRatioPct}%)`,
      detail: `Tồn tại ${orphanObjectCount} object trên MinIO không có bản ghi PostgreSQL tương ứng, chiếm ${orphanRatioPct}% tổng dung lượng bucket${sampleKeysText}.`,
      recommendedAction:
        'Đối soát danh sách MinIO Orphan Objects và chỉ xóa khi đã xác nhận không thuộc phiên upload đang hoạt động.',
      destructivePurgeBlocked: true,
    });
  }

  // 4. Integrity Failed & Stale Pending Uploads Alert
  const integrityFailedFiles = Math.floor(
    toNonNegativeNumber(overview.integrityFailedFiles, 0)
  );
  const stalePendingCount = Math.floor(
    toNonNegativeNumber(overview.stalePendingUploadsCount, 0)
  );
  if (integrityFailedFiles > 0) {
    alerts.push({
      id: 'integrity-failed-alert',
      category: STORAGE_ALERT_CATEGORY.INTEGRITY,
      severity: STORAGE_ALERT_SEVERITY.CRITICAL,
      title: `Phát hiện ${integrityFailedFiles} file lỗi toàn vẹn (INTEGRITY_FAILED)`,
      detail:
        'Có tệp media không khớp kích thước/checksum hoặc lỗi hoàn tất multipart upload.',
      recommendedAction:
        'Kiểm tra nhật ký upload của các tệp INTEGRITY_FAILED trước khi xóa.',
      destructivePurgeBlocked: true,
    });
  } else if (stalePendingCount > 0) {
    alerts.push({
      id: 'stale-pending-warning',
      category: STORAGE_ALERT_CATEGORY.ORPHAN,
      severity: STORAGE_ALERT_SEVERITY.WARNING,
      title: `Có ${stalePendingCount} phiên Pending Upload quá hạn chưa thu hồi`,
      detail:
        'Các phiên presigned upload bị bỏ dở đang chiếm giữ dung lượng tạm trên kho lưu trữ.',
      recommendedAction:
        'Sử dụng tác vụ dọn Pending Upload quá hạn trong Storage Cleanup Engine.',
      destructivePurgeBlocked: true,
    });
  }

  // 5. Storage Growth Velocity & Days-to-Quota Alert
  if (!growth.verified) {
    alerts.push({
      id: 'growth-unverified-alert',
      category: STORAGE_ALERT_CATEGORY.GROWTH,
      severity: STORAGE_ALERT_SEVERITY.UNVERIFIED,
      title: 'Tốc độ tăng trưởng chưa xác minh (Thiếu chuỗi xu hướng ngày)',
      detail: growth.reason,
      recommendedAction:
        'Cần tối thiểu dữ liệu recentDailyTrend theo ngày để tính tốc độ tăng trưởng và dự báo đầy kho.',
      destructivePurgeBlocked: true,
    });
  } else {
    const wow = growth.weekOverWeekGrowthPct;
    const daysLeft = growth.estimatedDaysToQuota;

    const isGrowthCritical =
      (wow !== null && wow >= thresholds.growthCriticalWoWPct) ||
      (daysLeft !== null && daysLeft <= thresholds.daysToFullCritical);
    const isGrowthWarning =
      !isGrowthCritical &&
      ((wow !== null && wow >= thresholds.growthWarningWoWPct) ||
        (daysLeft !== null && daysLeft <= thresholds.daysToFullWarning));

    if (isGrowthCritical || isGrowthWarning) {
      const wowText =
        wow !== null
          ? `tăng +${wow}% so với 7 ngày baseline liền trước`
          : 'tốc độ nạp dữ liệu cao';
      const daysText =
        daysLeft !== null
          ? ` (ước tính chạm hạn mức sau ~${daysLeft} ngày)`
          : '';
      alerts.push({
        id: isGrowthCritical ? 'growth-critical-alert' : 'growth-warning-alert',
        category: STORAGE_ALERT_CATEGORY.GROWTH,
        severity: isGrowthCritical
          ? STORAGE_ALERT_SEVERITY.CRITICAL
          : STORAGE_ALERT_SEVERITY.WARNING,
        title: isGrowthCritical
          ? `Tốc độ tăng trưởng lưu trữ tăng đột biến (${wowText})`
          : `Cảnh báo tốc độ tăng trưởng lưu trữ (${wowText})`,
        detail: `Trung bình 7 ngày gần nhất phát sinh ${growth.avgDailyFiles} file/ngày${daysText}.`,
        recommendedAction:
          'Rà soát lịch thu hồi Trash quá hạn và kiểm tra hạn mức lưu trữ bucket.',
        destructivePurgeBlocked: true,
      });
    }
  }

  const hasCritical = alerts.some(
    (a) => a.severity === STORAGE_ALERT_SEVERITY.CRITICAL
  );
  const hasWarning = alerts.some(
    (a) => a.severity === STORAGE_ALERT_SEVERITY.WARNING
  );
  const hasUnverified = alerts.some(
    (a) => a.severity === STORAGE_ALERT_SEVERITY.UNVERIFIED
  );

  const overallStatus = hasCritical
    ? STORAGE_ALERT_SEVERITY.CRITICAL
    : hasWarning
      ? STORAGE_ALERT_SEVERITY.WARNING
      : hasUnverified
        ? STORAGE_ALERT_SEVERITY.UNVERIFIED
        : STORAGE_ALERT_SEVERITY.HEALTHY;

  return {
    status: overallStatus,
    verified: true,
    bucketName,
    isAdmin,
    canConfigureThresholds: isAdmin,
    canTriggerSafeCleanup: isAdmin && (orphanMetrics.reclaimableCount || 0) > 0,
    autoPurgeAllowed: false,
    thresholds: {
      ...thresholds,
      quotaBytes,
    },
    capacity: {
      verified: true,
      dbTotalSizeBytes,
      minioTotalSizeBytes,
      effectiveUsedBytes,
      quotaBytes,
      capacityUsagePct,
    },
    orphanMetrics,
    growth,
    alerts,
  };
}

