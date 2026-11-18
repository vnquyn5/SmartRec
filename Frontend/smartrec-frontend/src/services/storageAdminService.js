import { api as httpClient } from '../lib/http/client.js';
import mockStorageSeed from '../mocks/mock_storage_admin.json';

const STORAGE_MOCK_KEY = 'smartrec.admin.storage.v1';

export const STORAGE_STATUSES = [
  'ALL',
  'UPLOADED',
  'TRASHED',
  'UPLOADING',
  'INTEGRITY_FAILED',
];

export const CLEANUP_TASK_TYPES = {
  EXPIRED_TRASH: 'EXPIRED_TRASH',
  STALE_PENDING_UPLOADS: 'STALE_PENDING_UPLOADS',
  CANCELLED_CHUNK_SESSIONS: 'CANCELLED_CHUNK_SESSIONS',
  ORPHAN_MINIO_OBJECTS: 'ORPHAN_MINIO_OBJECTS',
  ALL_SAFE: 'ALL_SAFE',
};

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exp;
  return `${scaled >= 100 || exp === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exp]}`;
}

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function cloneSeed() {
  return JSON.parse(JSON.stringify(mockStorageSeed));
}

function readMockState() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return cloneSeed();
    }
    const raw = window.localStorage.getItem(STORAGE_MOCK_KEY);
    if (!raw) {
      const seeded = cloneSeed();
      window.localStorage.setItem(STORAGE_MOCK_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return JSON.parse(raw);
  } catch {
    return cloneSeed();
  }
}

function writeMockState(state) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_MOCK_KEY, JSON.stringify(state));
    }
  } catch {
    // ignore storage quota errors
  }
  return state;
}

function unwrapResponse(res) {
  if (res && typeof res === 'object' && 'config' in res && 'data' in res) {
    return res.data;
  }
  return res;
}

function shouldFallbackToMock(err) {
  if (!err) return false;
  if (err.kind === 'network' || err.kind === 'timeout') return true;
  if (err.code === 'ERR_NETWORK') return true;
  const status = err.status ?? err.response?.status;
  if (status == null) return true;
  return status >= 500 || status === 404;
}

function categorizeMime(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.startsWith('audio/')) return 'Audio';
  if (normalized.startsWith('video/')) return 'Video';
  return 'Other';
}

function buildOverviewFromMockState(state) {
  const nowMs = Date.now();
  const objects = Array.isArray(state.objects) ? state.objects : [];
  const orphans = Array.isArray(state.orphans) ? state.orphans : [];

  const statusMap = {
    UPLOADED: { count: 0, sizeBytes: 0 },
    TRASHED: { count: 0, sizeBytes: 0 },
    UPLOADING: { count: 0, sizeBytes: 0 },
    INTEGRITY_FAILED: { count: 0, sizeBytes: 0 },
  };
  const mimeMap = {
    Audio: { count: 0, sizeBytes: 0 },
    Video: { count: 0, sizeBytes: 0 },
    Other: { count: 0, sizeBytes: 0 },
  };

  let totalSizeBytes = 0;
  let expiredTrashCount = 0;
  let expiredTrashBytes = 0;

  const dayMap = new Map();
  const anchorMs = objects.reduce((max, item) => {
    const t = Date.parse(item.createdAt || '');
    return Number.isFinite(t) && t > max ? t : max;
  }, Date.parse('2026-11-18T00:00:00Z'));

  for (let offset = 13; offset >= 0; offset--) {
    const d = new Date(anchorMs - offset * 86400000).toISOString().slice(0, 10);
    dayMap.set(d, { date: d, fileCount: 0, sizeBytes: 0 });
  }

  for (const item of objects) {
    const size = Number(item.fileSizeBytes || 0);
    const status = item.status || 'UPLOADED';
    totalSizeBytes += size;
    if (!statusMap[status]) statusMap[status] = { count: 0, sizeBytes: 0 };
    statusMap[status].count += 1;
    statusMap[status].sizeBytes += size;

    if (status === 'TRASHED' && item.purgeAt) {
      const purgeMs = Date.parse(item.purgeAt);
      if (Number.isFinite(purgeMs) && purgeMs <= nowMs) {
        expiredTrashCount += 1;
        expiredTrashBytes += size;
      }
    }

    const mimeCat = categorizeMime(item.mimeType);
    mimeMap[mimeCat].count += 1;
    mimeMap[mimeCat].sizeBytes += size;

    const createdDay = String(item.createdAt || '').slice(0, 10);
    if (dayMap.has(createdDay)) {
      const bucket = dayMap.get(createdDay);
      bucket.fileCount += 1;
      bucket.sizeBytes += size;
    }
  }

  const orphanTotalSizeBytes = orphans.reduce((acc, o) => acc + Number(o.sizeBytes || 0), 0);
  const pendingBytes = Number(state.stalePendingUploadBytes || 0);

  return {
    bucketName: state.bucketName || 'smartrec-media',
    minioConnected: state.minioConnected !== false,
    bucketHealthy: state.bucketHealthy !== false,
    minioWarning: state.minioWarning || null,
    totalFiles: objects.length,
    totalSizeBytes,
    uploadedFiles: statusMap.UPLOADED.count,
    uploadedSizeBytes: statusMap.UPLOADED.sizeBytes,
    trashedFiles: statusMap.TRASHED.count,
    trashedSizeBytes: statusMap.TRASHED.sizeBytes,
    uploadingFiles: statusMap.UPLOADING.count,
    uploadingSizeBytes: statusMap.UPLOADING.sizeBytes,
    integrityFailedFiles: statusMap.INTEGRITY_FAILED.count,
    integrityFailedSizeBytes: statusMap.INTEGRITY_FAILED.sizeBytes,
    expiredTrashCount,
    expiredTrashBytes,
    pendingUploadsCount: Number(state.pendingUploadsCount || 0),
    stalePendingUploadsCount: Number(state.stalePendingUploadsCount || 0),
    stalePendingUploadBytes: pendingBytes,
    activeUploadSessionsCount: Number(state.activeUploadSessionsCount || 0),
    cancelledUploadSessionsCount: Number(state.cancelledUploadSessionsCount || 0),
    minioObjectCount: objects.length + orphans.length,
    minioTotalSizeBytes: totalSizeBytes + orphanTotalSizeBytes,
    orphanObjectCount: orphans.length,
    orphanTotalSizeBytes,
    statusBreakdown: Object.entries(statusMap).map(([status, v]) => ({
      status,
      count: v.count,
      sizeBytes: v.sizeBytes,
    })),
    mimeBreakdown: Object.entries(mimeMap).map(([category, v]) => ({
      category,
      count: v.count,
      sizeBytes: v.sizeBytes,
    })),
    recentDailyTrend: Array.from(dayMap.values()),
  };
}

function queryMockObjects(state, { status = 'ALL', keyword = '', sort = 'created_at,desc', page = 0, size = 8 }) {
  const normStatus = String(status || 'ALL').toUpperCase();
  const normKeyword = String(keyword || '').trim().toLowerCase();
  const [sortField, sortDir] = String(sort || 'created_at,desc').split(',');
  const dir = sortDir === 'asc' ? 1 : -1;

  const filtered = (state.objects || []).filter((item) => {
    if (normStatus !== 'ALL' && item.status !== normStatus) return false;
    if (!normKeyword) return true;
    return (
      String(item.originalName || '').toLowerCase().includes(normKeyword) ||
      String(item.objectKey || '').toLowerCase().includes(normKeyword) ||
      String(item.mimeType || '').toLowerCase().includes(normKeyword) ||
      String(item.uploaderName || '').toLowerCase().includes(normKeyword)
    );
  });

  filtered.sort((a, b) => {
    if (sortField === 'file_size_bytes') {
      return ((a.fileSizeBytes || 0) - (b.fileSizeBytes || 0)) * dir;
    }
    if (sortField === 'original_name') {
      return String(a.originalName || '').localeCompare(String(b.originalName || '')) * dir;
    }
    return (Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '')) * dir;
  });

  const safePage = Math.max(Number(page) || 0, 0);
  const safeSize = Math.max(Number(size) || 8, 1);
  const start = safePage * safeSize;
  const content = filtered.slice(start, start + safeSize);

  return {
    content,
    page: safePage,
    size: safeSize,
    totalElements: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / safeSize)),
  };
}

export async function getStorageOverview() {
  try {
    const response = await httpClient.get('/admin/storage/overview');
    return { data: unwrapResponse(response), source: 'api' };
  } catch (err) {
    if (!shouldFallbackToMock(err)) throw err;
    const state = readMockState();
    return { data: buildOverviewFromMockState(state), source: 'local' };
  }
}

export async function getStorageObjects(filters = {}) {
  const params = {
    status: filters.status && filters.status !== 'ALL' ? filters.status : undefined,
    keyword: filters.keyword?.trim() || undefined,
    sort: filters.sort || 'created_at,desc',
    page: filters.page ?? 0,
    size: filters.size ?? 8,
  };
  try {
    const response = await httpClient.get('/admin/storage/objects', { params });
    return { data: unwrapResponse(response), source: 'api' };
  } catch (err) {
    if (!shouldFallbackToMock(err)) throw err;
    const state = readMockState();
    return { data: queryMockObjects(state, filters), source: 'local' };
  }
}

export async function getOrphanObjects() {
  try {
    const response = await httpClient.get('/admin/storage/orphans');
    const payload = unwrapResponse(response);
    return { data: Array.isArray(payload) ? payload : [], source: 'api' };
  } catch (err) {
    if (!shouldFallbackToMock(err)) throw err;
    const state = readMockState();
    return { data: state.orphans || [], source: 'local' };
  }
}

export async function runStorageCleanup(taskType) {
  try {
    const response = await httpClient.post('/admin/storage/cleanup', { taskType });
    return { data: unwrapResponse(response), source: 'api' };
  } catch (err) {
    if (!shouldFallbackToMock(err)) throw err;
    const state = readMockState();
    const nowMs = Date.now();
    let deletedCount = 0;
    let processedCount = 0;
    let freedBytes = 0;

    const runExpiredTrash = () => {
      const kept = [];
      for (const obj of state.objects || []) {
        const isExpired =
          obj.status === 'TRASHED' && obj.purgeAt && Date.parse(obj.purgeAt) <= nowMs;
        if (isExpired) {
          processedCount += 1;
          deletedCount += 1;
          freedBytes += Number(obj.fileSizeBytes || 0);
        } else {
          kept.push(obj);
        }
      }
      state.objects = kept;
    };

    const runStalePending = () => {
      const count = Number(state.stalePendingUploadsCount || 0);
      const bytes = Number(state.stalePendingUploadBytes || 0);
      processedCount += count;
      deletedCount += count;
      freedBytes += bytes;
      state.pendingUploadsCount = Math.max(0, Number(state.pendingUploadsCount || 0) - count);
      state.stalePendingUploadsCount = 0;
      state.stalePendingUploadBytes = 0;
    };

    const runCancelledSessions = () => {
      const count = Number(state.cancelledUploadSessionsCount || 0);
      processedCount += count;
      deletedCount += count;
      state.cancelledUploadSessionsCount = 0;
    };

    const runOrphans = () => {
      const orphans = state.orphans || [];
      processedCount += orphans.length;
      deletedCount += orphans.length;
      freedBytes += orphans.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
      state.orphans = [];
    };

    if (taskType === CLEANUP_TASK_TYPES.EXPIRED_TRASH) runExpiredTrash();
    else if (taskType === CLEANUP_TASK_TYPES.STALE_PENDING_UPLOADS) runStalePending();
    else if (taskType === CLEANUP_TASK_TYPES.CANCELLED_CHUNK_SESSIONS) runCancelledSessions();
    else if (taskType === CLEANUP_TASK_TYPES.ORPHAN_MINIO_OBJECTS) runOrphans();
    else if (taskType === CLEANUP_TASK_TYPES.ALL_SAFE) {
      runExpiredTrash();
      runStalePending();
      runCancelledSessions();
      runOrphans();
    }

    writeMockState(state);
    return {
      data: {
        taskType,
        processedCount,
        deletedCount,
        failedCount: 0,
        freedBytes,
        executedAt: new Date().toISOString(),
        message: `Đã dọn ${deletedCount}/${processedCount} mục (giải phóng ${formatBytes(freedBytes)})`,
        errors: [],
      },
      source: 'local',
    };
  }
}

export async function deleteStorageObject(mediaFileId, force = false) {
  try {
    await httpClient.delete(`/admin/storage/objects/${mediaFileId}`, {
      params: { force },
    });
    return { source: 'api' };
  } catch (err) {
    if (!shouldFallbackToMock(err)) throw err;
    const state = readMockState();
    const target = (state.objects || []).find((item) => item.id === mediaFileId);
    if (!target) {
      const notFound = new Error('Không tìm thấy MediaFile');
      notFound.response = { status: 404, data: { code: 'MEDIA_NOT_FOUND', message: 'Không tìm thấy MediaFile' } };
      throw notFound;
    }
    if (!force && target.status === 'UPLOADING') {
      const conflict = new Error('File đang tải lên');
      conflict.response = {
        status: 409,
        data: {
          code: 'MEDIA_UPLOADING_ACTIVE',
          message: 'File đang trong quá trình tải lên. Xác nhận Force Delete nếu chắc chắn muốn xóa.',
        },
      };
      throw conflict;
    }
    if (!force && target.hasLinkedMeeting) {
      const conflict = new Error('File đang gắn với cuộc họp');
      conflict.response = {
        status: 409,
        data: {
          code: 'MEDIA_LINKED_TO_MEETING',
          message: 'File đang gắn với một cuộc họp. Xác nhận Force Delete để xóa cả cuộc họp liên quan.',
        },
      };
      throw conflict;
    }
    state.objects = (state.objects || []).filter((item) => item.id !== mediaFileId);
    writeMockState(state);
    return { source: 'local' };
  }
}

export async function deleteOrphanObjects(objectKeys = []) {
  try {
    const response = await httpClient.delete('/admin/storage/orphans', {
      data: { objectKeys },
    });
    return { data: unwrapResponse(response), source: 'api' };
  } catch (err) {
    if (!shouldFallbackToMock(err)) throw err;
    const state = readMockState();
    const keySet = new Set(objectKeys);
    let deletedCount = 0;
    let freedBytes = 0;
    state.orphans = (state.orphans || []).filter((item) => {
      if (keySet.has(item.objectKey)) {
        deletedCount += 1;
        freedBytes += Number(item.sizeBytes || 0);
        return false;
      }
      return true;
    });
    writeMockState(state);
    return {
      data: {
        taskType: CLEANUP_TASK_TYPES.ORPHAN_MINIO_OBJECTS,
        processedCount: objectKeys.length,
        deletedCount,
        failedCount: 0,
        freedBytes,
        executedAt: new Date().toISOString(),
        message: `Đã xóa ${deletedCount} orphan object trên MinIO`,
        errors: [],
      },
      source: 'local',
    };
  }
}

export function resetStorageMockState() {
  const fresh = cloneSeed();
  writeMockState(fresh);
  return fresh;
}

