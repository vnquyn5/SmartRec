export const ERROR_BOUNDARY_KINDS = Object.freeze({
  CHUNK_LOAD_ERROR: 'CHUNK_LOAD_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  RUNTIME_RENDER_ERROR: 'RUNTIME_RENDER_ERROR',
});

const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /error loading dynamically imported module/i,
];

const NETWORK_ERROR_PATTERNS = [
  /NetworkError when attempting to fetch resource/i,
  /ERR_NETWORK/i,
];

const SENSITIVE_TOKEN_PATTERN =
  /([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|token|access_token|api_key|secret|password|sig)=)[^&\s]+/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi;
const FILE_PATH_PATTERN = /(?:[A-Za-z]:\\|file:\/\/\/)[^\s)]+/g;

export function redactErrorSecrets(rawText) {
  if (rawText === null || rawText === undefined) return '';
  const text = String(rawText).trim();
  if (!text) return '';
  return text
    .replace(SENSITIVE_TOKEN_PATTERN, '$1[REDACTED]')
    .replace(BEARER_PATTERN, '$1[REDACTED]')
    .replace(FILE_PATH_PATTERN, '[INTERNAL_PATH]');
}

export function classifyRuntimeError(error) {
  const name = String(error?.name || '').trim();
  const message = String(error?.message || error || '').trim();
  const combined = `${name} ${message}`;

  if (CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(combined))) {
    return ERROR_BOUNDARY_KINDS.CHUNK_LOAD_ERROR;
  }
  if (NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(combined))) {
    return ERROR_BOUNDARY_KINDS.NETWORK_ERROR;
  }
  return ERROR_BOUNDARY_KINDS.RUNTIME_RENDER_ERROR;
}

export function sanitizeErrorMessage(error, { isProduction = true } = {}) {
  const kind = classifyRuntimeError(error);
  if (kind === ERROR_BOUNDARY_KINDS.CHUNK_LOAD_ERROR) {
    return 'Phiên bản giao diện vừa được cập nhật hoặc kết nối mạng gián đoạn khi tải tài nguyên trang. Vui lòng tải lại trang.';
  }

  const rawMessage = String(error?.message || '').trim();
  if (!rawMessage) {
    return 'Đã xảy ra lỗi không mong muốn khi hiển thị khu vực này.';
  }

  const redacted = redactErrorSecrets(rawMessage);
  if (isProduction) {
    const firstLine = redacted.split(/\r?\n/)[0].slice(0, 180).trim();
    return firstLine || 'Đã xảy ra lỗi không mong muốn khi hiển thị khu vực này.';
  }

  return redacted;
}

export function hasResetKeysChanged(prevKeys = [], nextKeys = []) {
  if (!Array.isArray(prevKeys) || !Array.isArray(nextKeys)) return false;
  if (prevKeys.length !== nextKeys.length) return true;
  for (let i = 0; i < prevKeys.length; i += 1) {
    if (!Object.is(prevKeys[i], nextKeys[i])) {
      return true;
    }
  }
  return false;
}

export function buildErrorBoundaryViewModel(
  error,
  { level = 'page', isProduction = true } = {}
) {
  const kind = classifyRuntimeError(error);
  const isChunkError = kind === ERROR_BOUNDARY_KINDS.CHUNK_LOAD_ERROR;

  return {
    kind,
    level,
    isChunkError,
    title: isChunkError
      ? 'Không thể tải gói giao diện (Chunk Load Error)'
      : level === 'app'
        ? 'Ứng dụng gặp sự cố hiển thị'
        : 'Khu vực làm việc tạm thời gián đoạn',
    message: sanitizeErrorMessage(error, { isProduction }),
    primaryActionLabel: isChunkError ? 'Tải lại trang mới' : 'Thử lại ngay',
    secondaryActionLabel: 'Về danh sách cuộc họp',
  };
}

/**
 * Maps module IDs in node_modules to dedicated vendor chunks for Vite/Rollup production builds.
 */
export function resolveManualChunk(id) {
  if (!id || !id.includes('node_modules')) return undefined;
  const normalized = id.replace(/\\/g, '/');

  if (
    normalized.includes('/node_modules/video.js/') ||
    normalized.includes('/node_modules/@videojs/') ||
    normalized.includes('/node_modules/m3u8-parser/') ||
    normalized.includes('/node_modules/mpd-parser/') ||
    normalized.includes('/node_modules/mux.js/') ||
    normalized.includes('/node_modules/aes-decrypter/')
  ) {
    return 'vendor-media';
  }

  if (normalized.includes('/node_modules/chart.js/')) {
    return 'vendor-charts';
  }

  if (
    normalized.includes('/node_modules/react/') ||
    normalized.includes('/node_modules/react-dom/') ||
    normalized.includes('/node_modules/react-router') ||
    normalized.includes('/node_modules/@remix-run/') ||
    normalized.includes('/node_modules/scheduler/') ||
    normalized.includes('/node_modules/zustand/')
  ) {
    return 'vendor-react';
  }

  if (
    normalized.includes('/node_modules/axios/') ||
    normalized.includes('/node_modules/sockjs-client/') ||
    normalized.includes('/node_modules/stompjs/') ||
    normalized.includes('/node_modules/spark-md5/') ||
    normalized.includes('/node_modules/hash-wasm/')
  ) {
    return 'vendor-network';
  }

  return undefined;
}

