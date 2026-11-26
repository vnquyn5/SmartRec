import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_BOUNDARY_KINDS,
  buildErrorBoundaryViewModel,
  classifyRuntimeError,
  hasResetKeysChanged,
  redactErrorSecrets,
  resolveManualChunk,
  sanitizeErrorMessage,
} from './errorBoundaryUtils.js';

test('TC01: Classifies dynamic import and chunk load errors as CHUNK_LOAD_ERROR', () => {
  const dynamicImportErr = new TypeError(
    'Failed to fetch dynamically imported module: https://smartrec.local/assets/MeetingDetailPage-123.js'
  );
  assert.equal(
    classifyRuntimeError(dynamicImportErr),
    ERROR_BOUNDARY_KINDS.CHUNK_LOAD_ERROR
  );

  const webpackChunkErr = new Error('Loading chunk 14 failed.');
  webpackChunkErr.name = 'ChunkLoadError';
  assert.equal(
    classifyRuntimeError(webpackChunkErr),
    ERROR_BOUNDARY_KINDS.CHUNK_LOAD_ERROR
  );
});

test('TC02: Classifies normal render exceptions as RUNTIME_RENDER_ERROR', () => {
  const renderErr = new TypeError("Cannot read properties of null (reading 'segments')");
  assert.equal(
    classifyRuntimeError(renderErr),
    ERROR_BOUNDARY_KINDS.RUNTIME_RENDER_ERROR
  );
});

test('TC03: Redacts sensitive query tokens, Bearer tokens, and local filesystem paths from error messages', () => {
  const leakedError = new Error(
    'Failed loading C:\\Users\\Admin\\secret.js with ?X-Amz-Signature=supersecret123&token=my_tok and Bearer eyJhbGciOi.test'
  );
  const sanitized = sanitizeErrorMessage(leakedError, { isProduction: true });
  assert.ok(!sanitized.includes('supersecret123'));
  assert.ok(!sanitized.includes('my_tok'));
  assert.ok(!sanitized.includes('eyJhbGciOi'));
  assert.ok(!sanitized.includes('C:\\Users\\Admin'));
  assert.ok(sanitized.includes('[REDACTED]'));
  assert.equal(redactErrorSecrets(null), '');
});

test('TC04: Detects resetKeys changes when navigating between routes', () => {
  assert.equal(hasResetKeysChanged(['/history', ''], ['/history', '']), false);
  assert.equal(hasResetKeysChanged(['/history', ''], ['/admin/storage', '']), true);
  assert.equal(hasResetKeysChanged(['/governance', '?tab=models'], ['/governance', '?tab=usage']), true);
});

test('TC05: Builds appropriate fallback view model for page vs app level errors', () => {
  const chunkVm = buildErrorBoundaryViewModel(
    new Error('Importing a module script failed.'),
    { level: 'page', isProduction: true }
  );
  assert.equal(chunkVm.isChunkError, true);
  assert.equal(chunkVm.primaryActionLabel, 'Tải lại trang mới');

  const runtimeVm = buildErrorBoundaryViewModel(
    new Error('Unexpected render state'),
    { level: 'app', isProduction: true }
  );
  assert.equal(runtimeVm.isChunkError, false);
  assert.equal(runtimeVm.title, 'Ứng dụng gặp sự cố hiển thị');
});

test('TC06: Splits heavy node_modules dependencies into dedicated vendor chunks', () => {
  assert.equal(
    resolveManualChunk('G:/SmartRec Demo/node_modules/video.js/dist/video.es.js'),
    'vendor-media'
  );
  assert.equal(
    resolveManualChunk('/app/node_modules/chart.js/dist/chart.js'),
    'vendor-charts'
  );
  assert.equal(
    resolveManualChunk('/app/node_modules/react-dom/index.js'),
    'vendor-react'
  );
  assert.equal(
    resolveManualChunk('/app/node_modules/axios/index.js'),
    'vendor-network'
  );
  assert.equal(
    resolveManualChunk('/app/src/pages/meeting/MeetingDetailPage.jsx'),
    undefined
  );
});

