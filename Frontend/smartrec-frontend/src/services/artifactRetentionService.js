import { api as httpClient } from '../lib/http/client.js';
import {
  ARTIFACT_INTEGRITY_STATUS,
  ARTIFACT_LIFECYCLE,
  ARTIFACT_TYPES,
  RETENTION_PURGE_DECISION,
  evaluateArtifactIntegrity,
  evaluateArtifactRegistrySnapshot,
  evaluateRetentionPurgeGuard,
} from './artifactRetentionValidator.js';

export {
  ARTIFACT_INTEGRITY_STATUS,
  ARTIFACT_LIFECYCLE,
  ARTIFACT_TYPES,
  RETENTION_PURGE_DECISION,
  evaluateArtifactIntegrity,
  evaluateArtifactRegistrySnapshot,
  evaluateRetentionPurgeGuard,
};

export const ARTIFACT_VERSION_ENDPOINTS = Object.freeze({
  list: '/admin/storage/artifacts/versions',
});

function extractArtifactApiError(error) {
  const statusCode = error?.response?.status ?? error?.status;
  const serverMessage = error?.response?.data?.message;

  if (statusCode === 401 || statusCode === 403) {
    return 'Không đủ quyền truy cập danh mục phiên bản dataset/artifacts (403 Forbidden).';
  }
  if (statusCode === 404 || statusCode === 501) {
    return 'Endpoint quản lý phiên bản dataset & retention chưa sẵn sàng trên Backend — giữ trạng thái Chưa xác minh (BR03).';
  }
  if (typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage.trim();
  }
  return 'Không thể tải dữ liệu phiên bản dataset/artifacts từ Backend — giữ trạng thái Chưa xác minh.';
}

/**
 * Loads dataset & AI artifact version metadata with retention rules from Backend.
 * Strictly avoids mock fallback so missing policy/dataset is surfaced as UNVERIFIED (BR03).
 */
export async function getArtifactVersionsRegistry(
  { user = null, type = 'ALL', integrity = 'ALL', keyword = '' } = {},
  client = httpClient
) {
  const params = {
    type: type && type !== 'ALL' ? type : undefined,
    integrity: integrity && integrity !== 'ALL' ? integrity : undefined,
    keyword: keyword?.trim() || undefined,
  };

  try {
    const response = await client.get(ARTIFACT_VERSION_ENDPOINTS.list, { params });
    const payload =
      response && typeof response === 'object' && 'config' in response && 'data' in response
        ? response.data
        : response;
    const snapshot = evaluateArtifactRegistrySnapshot(payload, { user });

    if (snapshot.status === ARTIFACT_INTEGRITY_STATUS.UNVERIFIED && snapshot.items.length === 0) {
      return {
        source: 'unverified',
        snapshot,
        error: 'Backend chưa trả về danh mục phiên bản dataset/artifacts hoặc retention policy hợp lệ.',
      };
    }

    return {
      source: 'api',
      snapshot,
      error: null,
    };
  } catch (error) {
    return {
      source: 'unverified',
      snapshot: evaluateArtifactRegistrySnapshot(null, { user }),
      error: extractArtifactApiError(error),
    };
  }
}

