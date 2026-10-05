import { useSyncExternalStore } from "react";
import {
  cancelChunkedUpload,
  getChunkedUploadStatus,
  initChunkedUpload,
  mergeChunkedUpload,
  pauseChunkedUpload,
  resumeChunkedUpload,
  uploadChunk,
} from "../services/chunkedUploadService";
import { FileChunk, sliceFileToBlobs } from "../utils/fileSlice";

type LargeUploadPhase =
  | "idle"
  | "uploading"
  | "paused"
  | "needs_file"
  | "ready_to_merge"
  | "merging"
  | "success"
  | "canceled"
  | "upload_failed"
  | "merge_failed";

export interface LargeUploadItem {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  lastModified: number;
  hasFile: boolean;
  chunks: FileChunk[];
  uploadSessionId: string | null;
  backendChunkSize: number | null;
  uploadedChunkIndexes: number[];
  phase: LargeUploadPhase;
  progress: number;
  uploadedChunks: number;
  speedBps: number;
  retryCount: number;
  error: string | null;
  mergeStarted: boolean;
  mergeResponse: unknown;
  duplicateMetadata?: {
    quickFingerprint?: string | null;
    checksumSha256?: string | null;
  } | null;
  completedAt?: string | null;
  saved?: boolean;
  saveRequested?: boolean;
}

interface StoreState {
  items: LargeUploadItem[];
  activeItemId: string | null;
}

interface PersistedItem {
  id: string;
  uploadSessionId: string | null;
  fileName: string;
  fileSize: number;
  fileType?: string;
  lastModified: number;
  totalChunks: number;
  backendChunkSize: number | null;
  uploadedChunkIndexes: number[];
  uploadedChunks?: number;
  progress?: number;
  phase: LargeUploadPhase;
  error?: string | null;
  completedAt?: string | null;
  saveRequested?: boolean;
  duplicateMetadata?: {
    quickFingerprint?: string | null;
    checksumSha256?: string | null;
  } | null;
}

const STORAGE_KEY = "smartrec.largeUpload.sessions.v1";
const MAX_RETRIES = 3;
const CONCURRENCY = 3;
const MERGE_POLL_INTERVAL_MS = 2500;
const MERGE_POLL_TIMEOUT_MS = 15 * 60 * 1000;

const listeners = new Set<() => void>();

let state: StoreState = {
  items: [],
  activeItemId: null,
};

let abortController: AbortController | null = null;
let isPaused = false;
let activeWorkers = 0;
let pendingChunkIndexes: number[] = [];
let totalBytesUploaded = 0;
let lastSpeedTime = 0;
let lastSpeedBytes = 0;
let uploadRunId = 0;
const resumeInFlightSessionIds = new Set<string>();
const mergePollInFlightSessionIds = new Set<string>();

const getFileKey = (file: File) =>
  `${file.name}-${file.size}-${file.lastModified}`;

const emit = () => listeners.forEach((listener) => listener());

const persist = () => {
  const payload = state.items
    .map<PersistedItem>((item) => ({
    id: item.id,
    uploadSessionId: item.uploadSessionId,
    fileName: item.fileName,
    fileSize: item.fileSize,
    fileType: item.file.type,
    lastModified: item.lastModified,
    totalChunks: item.chunks.length,
    backendChunkSize: item.backendChunkSize,
    uploadedChunkIndexes: item.uploadedChunkIndexes,
    uploadedChunks: item.uploadedChunks,
    progress: item.progress,
    phase: item.phase,
    error: item.error,
    duplicateMetadata: item.duplicateMetadata || null,
    completedAt: item.completedAt || (item.phase === "success" ? new Date().toISOString() : null),
    saveRequested: Boolean(item.saveRequested),
  }));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

const readPersisted = (): PersistedItem[] => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
};

const setState = (updater: (currentState: StoreState) => StoreState) => {
  state = updater(state);
  persist();
  emit();
};

const updateItem = (id: string, updates: Partial<LargeUploadItem>) => {
  setState((currentState) => ({
    ...currentState,
    items: currentState.items.map((item) =>
      item.id === id ? { ...item, ...updates } : item,
    ),
  }));
};

const getActiveItem = () =>
  state.items.find((item) => item.id === state.activeItemId) || null;

const normalizePersistedPhase = (
  phase: LargeUploadPhase | "error" | undefined,
  hasUploadedAllChunks: boolean,
): LargeUploadPhase => {
  if (phase === "error") {
    return hasUploadedAllChunks ? "merge_failed" : "upload_failed";
  }
  if (hasUploadedAllChunks) {
    if (phase === "merge_failed") return "merge_failed";
    if (phase === "success") return "success";
    if (phase === "merging") return "merging";
    return "ready_to_merge";
  }
  if (phase === "uploading" || phase === "paused") return "needs_file";
  return phase || "idle";
};

const buildChunksFromMetadata = (
  fileSize: number,
  totalChunks: number,
  backendChunkSize: number | null,
): FileChunk[] => {
  const chunkSize = backendChunkSize || Math.ceil(fileSize / Math.max(totalChunks, 1));
  return Array.from({ length: totalChunks }, (_, index) => {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, fileSize);
    return { index, start, end, size: Math.max(end - start, 0) };
  });
};

const createFilePlaceholder = (item: PersistedItem) =>
  ({
    name: item.fileName,
    size: item.fileSize,
    lastModified: item.lastModified,
    type: item.fileType || "application/octet-stream",
  }) as File;

const buildRestoredItem = (persistedItem: PersistedItem): LargeUploadItem => {
  const chunks = buildChunksFromMetadata(
    persistedItem.fileSize,
    persistedItem.totalChunks,
    persistedItem.backendChunkSize,
  );
  const uploadedChunkIndexes = persistedItem.uploadedChunkIndexes || [];
  return {
    id: persistedItem.id,
    file: createFilePlaceholder(persistedItem),
    fileName: persistedItem.fileName,
    fileSize: persistedItem.fileSize,
    lastModified: persistedItem.lastModified,
    hasFile: false,
    chunks,
    uploadSessionId: persistedItem.uploadSessionId,
    backendChunkSize: persistedItem.backendChunkSize,
    uploadedChunkIndexes,
    phase: normalizePersistedPhase(
      persistedItem.phase,
      uploadedChunkIndexes.length === chunks.length,
    ),
    progress:
      persistedItem.progress ??
      Math.round((uploadedChunkIndexes.length / chunks.length) * 100),
    uploadedChunks: persistedItem.uploadedChunks ?? uploadedChunkIndexes.length,
    speedBps: 0,
    retryCount: 0,
    error: persistedItem.error || null,
    mergeStarted: persistedItem.phase === "merging",
    mergeResponse: null,
    duplicateMetadata: persistedItem.duplicateMetadata || null,
    completedAt: persistedItem.completedAt || null,
    saved: false,
    saveRequested: Boolean(persistedItem.saveRequested),
  };
};

const buildItem = (
  file: File,
  duplicateMetadata: LargeUploadItem["duplicateMetadata"] = null,
): LargeUploadItem => {
  const persistedItem = readPersisted().find(
    (item) =>
      item.fileName === file.name &&
      item.fileSize === file.size &&
      item.lastModified === file.lastModified,
  );
  const chunks = persistedItem?.backendChunkSize
    ? sliceFileToBlobs(file, persistedItem.backendChunkSize)
    : sliceFileToBlobs(file);
  const uploadedChunkIndexes = persistedItem?.uploadedChunkIndexes || [];
  const hasUploadedAllChunks =
    chunks.length > 0 && uploadedChunkIndexes.length === chunks.length;

  const restoredPhase = normalizePersistedPhase(
    persistedItem?.phase as LargeUploadPhase | "error" | undefined,
    hasUploadedAllChunks,
  );

  return {
    id: getFileKey(file),
    file,
    fileName: file.name,
    fileSize: file.size,
    lastModified: file.lastModified,
    hasFile: true,
    chunks,
    uploadSessionId: persistedItem?.uploadSessionId || null,
    backendChunkSize: persistedItem?.backendChunkSize || null,
    uploadedChunkIndexes,
    phase: restoredPhase,
    progress: Math.round((uploadedChunkIndexes.length / chunks.length) * 100),
    uploadedChunks: uploadedChunkIndexes.length,
    speedBps: 0,
    retryCount: 0,
    error: null,
    mergeStarted: false,
    mergeResponse: null,
    duplicateMetadata: duplicateMetadata || persistedItem?.duplicateMetadata || null,
    completedAt: null,
    saved: false,
    saveRequested: Boolean(persistedItem?.saveRequested),
  };
};

const persistedAtStartup = readPersisted();
if (persistedAtStartup.length > 0) {
  state = {
    items: persistedAtStartup.map(buildRestoredItem),
    activeItemId: persistedAtStartup[0]?.id || null,
  };
}

const ensureSession = async (item: LargeUploadItem) => {
  if (item.uploadSessionId) {
    if (import.meta.env.DEV) {
      console.log("[large-upload-store:ensure-session:reuse]", {
        id: item.id,
        fileName: item.fileName,
        uploadSessionId: item.uploadSessionId,
      });
    }
    return item;
  }

  if (import.meta.env.DEV) {
    console.log("[large-upload-store:ensure-session:init]", {
      id: item.id,
      fileName: item.file.name,
      fileSize: item.file.size,
      totalChunks: item.chunks.length,
      quickFingerprint: item.duplicateMetadata?.quickFingerprint || null,
    });
  }

  const initResponse = await initChunkedUpload({
    fileName: item.file.name,
    fileSize: item.file.size,
    totalChunks: item.chunks.length,
    quickFingerprint: item.duplicateMetadata?.quickFingerprint || null,
  });
  const backendChunkSize = Number(initResponse.chunkSize) || null;
  const chunks = backendChunkSize
    ? sliceFileToBlobs(item.file, backendChunkSize)
    : item.chunks;

  const updatedItem = {
    ...item,
    chunks,
    uploadSessionId: initResponse.uploadSessionId,
    backendChunkSize,
    mergeStarted: false,
  };

  updateItem(item.id, updatedItem);
  return updatedItem;
};

const refreshProgress = (itemId: string, chunk: FileChunk) => {
  const item = state.items.find((currentItem) => currentItem.id === itemId);
  if (!item) return;

  const uploadedChunkIndexes = Array.from(
    new Set([...item.uploadedChunkIndexes, chunk.index]),
  ).sort((a, b) => a - b);
  totalBytesUploaded += chunk.size;

  const updates: Partial<LargeUploadItem> = {
    uploadedChunkIndexes,
    uploadedChunks: uploadedChunkIndexes.length,
    progress: Math.round((uploadedChunkIndexes.length / item.chunks.length) * 100),
  };

  const now = Date.now();
  const timeDiff = (now - lastSpeedTime) / 1000;
  if (timeDiff >= 1) {
    const bytesDiff = totalBytesUploaded - lastSpeedBytes;
    if (bytesDiff > 0) updates.speedBps = bytesDiff / timeDiff;
    lastSpeedTime = now;
    lastSpeedBytes = totalBytesUploaded;
  }

  updateItem(itemId, updates);
};

const isAlreadyUploadedError = (error: unknown) => {
  const appError = error as { code?: string; message?: string; status?: number };
  return (
    appError.code === "CHUNK_ALREADY_EXISTS" ||
    appError.code === "CHUNK_ALREADY_UPLOADED" ||
    appError.message?.toLowerCase().includes("chunk đã được upload") ||
    appError.message?.toLowerCase().includes("chunk da duoc upload")
  );
};

const isInvalidUploadSessionStatusError = (error: unknown) => {
  const appError = error as { code?: string; message?: string };
  return appError.code === "INVALID_UPLOAD_SESSION_STATUS";
};

const getErrorMessage = (error: unknown) => {
  const appError = error as { message?: string };
  return appError.message || "Đã có lỗi xảy ra.";
};

const getErrorCode = (error: unknown) => {
  const appError = error as { code?: string };
  return appError.code;
};

const parseMissingChunkIndexes = (error: unknown): number[] => {
  const appError = error as { code?: string; detail?: unknown; message?: string };
  if (appError.code !== "MISSING_UPLOAD_CHUNKS") return [];

  if (Array.isArray(appError.detail)) {
    return appError.detail
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0);
  }

  const matches = appError.message?.match(/\d+/g) || [];
  return matches
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0);
};

const removeUploadedChunkIndexes = (itemId: string, missingChunkIndexes: number[]) => {
  if (missingChunkIndexes.length === 0) return;
  const missingSet = new Set(missingChunkIndexes);
  const item = state.items.find((currentItem) => currentItem.id === itemId);
  if (!item) return;
  const uploadedChunkIndexes = item.uploadedChunkIndexes.filter(
    (chunkIndex) => !missingSet.has(chunkIndex),
  );
  updateItem(itemId, {
    uploadedChunkIndexes,
    uploadedChunks: uploadedChunkIndexes.length,
    progress: Math.round((uploadedChunkIndexes.length / item.chunks.length) * 100),
    phase: "upload_failed",
    mergeStarted: false,
    speedBps: 0,
    error: `Thiếu chunk: ${missingChunkIndexes.join(", ")}`,
  });
};

const reconcileUploadCompletion = async (item: LargeUploadItem) => {
  if (!item.uploadSessionId) return false;
  const status = await getChunkedUploadStatus(item.uploadSessionId);
  const missingChunkIndexes = status.missingChunks || [];
  if (missingChunkIndexes.length > 0) {
    removeUploadedChunkIndexes(item.id, missingChunkIndexes);
    return false;
  }

  if (
    status.receivedChunks >= status.totalChunks &&
    ["READY_TO_MERGE", "MERGING", "COMPLETED"].includes(status.status)
  ) {
    const nextPhase = status.status === "MERGING"
      ? "merging"
      : status.status === "COMPLETED"
        ? "success"
        : "ready_to_merge";
    updateItem(item.id, {
      phase: nextPhase,
      progress: 100,
      uploadedChunks: item.chunks.length,
      retryCount: 0,
      error: null,
      speedBps: 0,
      mergeStarted: status.status === "MERGING",
    });
    if (status.status === "MERGING") {
      pollMergeStatus(item.id, item.uploadSessionId).catch(() => {});
    }
    return true;
  }

  updateItem(item.id, {
    phase: "upload_failed",
    uploadedChunks: Math.min(status.receivedChunks, item.chunks.length),
    progress: Math.round((Math.min(status.receivedChunks, item.chunks.length) / item.chunks.length) * 100),
    error: "Backend chưa xác nhận đủ chunk.",
    speedBps: 0,
  });
  return false;
};

const processQueue = (runId: number, controller: AbortController) => {
  const item = getActiveItem();
  if (!item || isPaused || item.phase !== "uploading" || !item.uploadSessionId) {
    return;
  }

  const worker = async () => {
    activeWorkers += 1;
    while (pendingChunkIndexes.length > 0 && !isPaused && runId === uploadRunId) {
      const chunkIndex = pendingChunkIndexes.shift();
      if (chunkIndex == null) break;

      const latestItem = getActiveItem();
      const chunk = latestItem?.chunks[chunkIndex];
      if (!latestItem || !chunk || latestItem.uploadedChunkIndexes.includes(chunk.index)) {
        continue;
      }

      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          if (controller.signal.aborted || isPaused || runId !== uploadRunId) break;
          await uploadChunk({
            uploadSessionId: latestItem.uploadSessionId!,
            chunkIndex: chunk.index,
            blob: latestItem.file.slice(
              chunk.start,
              chunk.end,
              latestItem.file.type,
            ),
            signal: controller.signal,
          });
          lastError = null;
          refreshProgress(latestItem.id, chunk);
          break;
        } catch (error) {
          if (controller.signal.aborted || isPaused || runId !== uploadRunId) break;
          console.warn("[chunked-upload] chunk upload failed", {
            uploadSessionId: latestItem.uploadSessionId,
            chunkIndex: chunk.index,
            attempt,
            code: getErrorCode(error),
            message: getErrorMessage(error),
            error,
          });
          if (isAlreadyUploadedError(error)) {
            lastError = null;
            refreshProgress(latestItem.id, chunk);
            break;
          }
          if (isInvalidUploadSessionStatusError(error)) {
            lastError = error as Error;
            break;
          }
          lastError = error as Error;
          const currentRetryCount =
            state.items.find((currentItem) => currentItem.id === latestItem.id)
              ?.retryCount || 0;
          updateItem(latestItem.id, { retryCount: currentRetryCount + 1 });
          if (attempt < MAX_RETRIES) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, 500 * attempt),
            );
          }
        }
      }

      if (lastError && !controller.signal.aborted && !isPaused && runId === uploadRunId) {
        controller.abort();
        updateItem(latestItem.id, {
          phase: "upload_failed",
          error: getErrorMessage(lastError) || "Upload chunk thất bại",
          speedBps: 0,
        });
        break;
      }
    }

    activeWorkers = Math.max(0, activeWorkers - 1);
    const latestItem = getActiveItem();
    if (
      latestItem &&
      !isPaused &&
      runId === uploadRunId &&
      latestItem.uploadedChunkIndexes.length === latestItem.chunks.length
    ) {
      try {
        await reconcileUploadCompletion(latestItem);
      } catch (error) {
        updateItem(latestItem.id, {
          phase: "upload_failed",
          error: getErrorMessage(error) || "Không thể xác nhận trạng thái upload",
          speedBps: 0,
        });
      }
    }
  };

  const workersToStart = Math.min(CONCURRENCY - activeWorkers, pendingChunkIndexes.length);
  for (let index = 0; index < workersToStart; index += 1) worker();
};

const mergeUpload = async (item: LargeUploadItem) => {
  const latestItem = state.items.find((currentItem) => currentItem.id === item.id);
  if (!latestItem) return null;
  if (latestItem.phase === "success") {
    updateItem(latestItem.id, { saveRequested: true });
    return {
      ...latestItem,
      saveRequested: true,
    };
  }
  if (latestItem.phase === "merging" || latestItem.mergeStarted) {
    updateItem(latestItem.id, { saveRequested: true });
    if (latestItem.uploadSessionId) {
      await pollMergeStatus(latestItem.id, latestItem.uploadSessionId).catch(() => null);
    }
    const currentItem = state.items.find((current) => current.id === latestItem.id);
    return currentItem?.phase === "success" ? currentItem : null;
  }
  if (
    !latestItem.uploadSessionId ||
    latestItem.uploadedChunkIndexes.length !== latestItem.chunks.length
  ) {
    return null;
  }

  updateItem(latestItem.id, {
    phase: "merging",
    mergeStarted: true,
    saveRequested: true,
    speedBps: 0,
    error: null,
  });
  try {
    const mergeResponse = await mergeChunkedUpload(
      latestItem.uploadSessionId,
      latestItem.file.name,
    );
    let finalMergeResponse = mergeResponse;
    if (mergeResponse.status === "MERGING") {
      finalMergeResponse =
        (await pollMergeStatus(latestItem.id, latestItem.uploadSessionId)) ||
        mergeResponse;
    }
    const completedAt = new Date().toISOString();
    const itemAfterPolling =
      state.items.find((currentItem) => currentItem.id === latestItem.id) ||
      latestItem;
    updateItem(latestItem.id, {
      phase: "success",
      progress: 100,
      uploadedChunks: latestItem.chunks.length,
      speedBps: 0,
      mergeResponse: finalMergeResponse,
      completedAt: itemAfterPolling.completedAt || completedAt,
      saveRequested: true,
    });
    return {
      ...itemAfterPolling,
      phase: "success" as LargeUploadPhase,
      progress: 100,
      uploadedChunks: latestItem.chunks.length,
      speedBps: 0,
      mergeResponse: finalMergeResponse,
      completedAt: itemAfterPolling.completedAt || completedAt,
      saveRequested: true,
    };
  } catch (error) {
    const missingChunkIndexes = parseMissingChunkIndexes(error);
    if (missingChunkIndexes.length > 0) {
      removeUploadedChunkIndexes(latestItem.id, missingChunkIndexes);
      return null;
    }
    updateItem(latestItem.id, {
      phase: "merge_failed",
      error: getErrorMessage(error) || "Merge upload thất bại",
      mergeStarted: false,
      speedBps: 0,
    });
    return null;
  }
};

const pollMergeStatus = async (itemId: string, uploadSessionId: string) => {
  if (mergePollInFlightSessionIds.has(uploadSessionId)) return;
  mergePollInFlightSessionIds.add(uploadSessionId);
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < MERGE_POLL_TIMEOUT_MS) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, MERGE_POLL_INTERVAL_MS),
      );

      const currentItem = state.items.find((item) => item.id === itemId);
      if (!currentItem || currentItem.phase !== "merging") return;

      const statusResponse = await getChunkedUploadStatus(uploadSessionId);
      if (statusResponse.status === "COMPLETED") {
        const completedAt = new Date().toISOString();
        updateItem(itemId, {
          phase: "success",
          progress: 100,
          uploadedChunks: currentItem.chunks.length,
          speedBps: 0,
          error: null,
          mergeResponse: statusResponse,
          completedAt,
        });
        return statusResponse;
      }
      if (
        statusResponse.status === "FAILED" ||
        statusResponse.status === "MERGE_FAILED" ||
        statusResponse.status === "CANCELLED"
      ) {
        updateItem(itemId, {
          phase:
            statusResponse.status === "CANCELLED" ? "canceled" : "merge_failed",
          mergeStarted: false,
          speedBps: 0,
          error: "Merge upload thất bại. Bạn có thể thử lại merge.",
        });
        throw new Error("Merge upload thất bại. Bạn có thể thử lại merge.");
      }
    }

    throw new Error("Merge upload chưa hoàn tất sau thời gian chờ.");
  } finally {
    mergePollInFlightSessionIds.delete(uploadSessionId);
  }
};

const applyBackendStatus = (
  item: LargeUploadItem,
  statusResponse: Awaited<ReturnType<typeof getChunkedUploadStatus>>,
) => {
  const totalChunks = statusResponse.totalChunks || item.chunks.length;
  const receivedChunks = Math.min(statusResponse.receivedChunks || 0, totalChunks);
  const uploadedChunkIndexes =
    statusResponse.missingChunks && statusResponse.missingChunks.length > 0
      ? Array.from({ length: totalChunks }, (_, index) => index).filter(
          (index) => !statusResponse.missingChunks?.includes(index),
        )
      : Array.from({ length: receivedChunks }, (_, index) => index);
  const progress = totalChunks > 0
    ? Math.round((uploadedChunkIndexes.length / totalChunks) * 100)
    : 0;

  if (statusResponse.status === "READY_TO_MERGE") {
    updateItem(item.id, {
      phase: "ready_to_merge",
      uploadedChunkIndexes,
      uploadedChunks: uploadedChunkIndexes.length,
      progress: 100,
      error: null,
      speedBps: 0,
      mergeStarted: false,
    });
    return;
  }

  if (statusResponse.status === "MERGING") {
    updateItem(item.id, {
      phase: "merging",
      uploadedChunkIndexes,
      uploadedChunks: uploadedChunkIndexes.length,
      progress: 100,
      error: null,
      speedBps: 0,
      mergeStarted: true,
    });
    pollMergeStatus(item.id, item.uploadSessionId!).catch(() => {});
    return;
  }

  if (statusResponse.status === "COMPLETED") {
    updateItem(item.id, {
      phase: "success",
      uploadedChunkIndexes,
      uploadedChunks: totalChunks,
      progress: 100,
      error: null,
      speedBps: 0,
      mergeStarted: false,
    });
    return;
  }

  if (statusResponse.status === "MERGE_FAILED" || statusResponse.status === "FAILED") {
    updateItem(item.id, {
      phase: "merge_failed",
      uploadedChunkIndexes,
      uploadedChunks: uploadedChunkIndexes.length,
      progress,
      error: "Merge upload thất bại. Bạn có thể thử lại merge.",
      speedBps: 0,
      mergeStarted: false,
    });
    return;
  }

  if (statusResponse.status === "CANCELLED") {
    updateItem(item.id, {
      phase: "canceled",
      uploadedChunkIndexes,
      uploadedChunks: uploadedChunkIndexes.length,
      progress,
      error: "Upload đã huỷ.",
      speedBps: 0,
      mergeStarted: false,
    });
    return;
  }

  updateItem(item.id, {
    phase: item.hasFile ? "paused" : "needs_file",
    uploadedChunkIndexes,
    uploadedChunks: uploadedChunkIndexes.length,
    progress,
    error: item.hasFile ? null : "Cần chọn lại file để tiếp tục upload.",
    speedBps: 0,
    mergeStarted: false,
  });
};

const restorePersistedSessions = async () => {
  const itemsToRestore = [...state.items].filter((item) => item.uploadSessionId);
  for (const item of itemsToRestore) {
    try {
      const statusResponse = await getChunkedUploadStatus(item.uploadSessionId!);
      applyBackendStatus(item, statusResponse);
    } catch (error) {
      updateItem(item.id, {
        phase: item.hasFile ? "paused" : "needs_file",
        error: getErrorMessage(error) || "Không thể khôi phục trạng thái upload.",
        speedBps: 0,
      });
    }
  }
};

if (persistedAtStartup.length > 0) {
  window.setTimeout(() => {
    restorePersistedSessions().catch(() => {});
  }, 0);
}

export const largeUploadStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return state;
  },
  addFiles(
    files: File[],
    duplicateMetadataById: Record<string, LargeUploadItem["duplicateMetadata"]> = {},
  ) {
    const nextItems = files.map((file) =>
      buildItem(file, duplicateMetadataById[getFileKey(file)] || null),
    );

    setState((currentState) => {
      if (import.meta.env.DEV) {
        console.log("[large-upload-store:add-files]", {
          incomingFiles: files.map((file) => ({
            id: getFileKey(file),
            fileName: file.name,
            fileSize: file.size,
            duplicateMetadata: duplicateMetadataById[getFileKey(file)] || null,
          })),
          currentItems: currentState.items.map((item) => ({
            id: item.id,
            fileName: item.fileName,
            phase: item.phase,
            uploadSessionId: item.uploadSessionId || null,
          })),
        });
      }
      const itemMap = new Map(currentState.items.map((item) => [item.id, item]));
      nextItems.forEach((item) => {
        const existingItem = itemMap.get(item.id);
        itemMap.set(
          item.id,
          existingItem
            ? {
                ...existingItem,
                file: item.file,
                fileName: item.fileName,
                fileSize: item.fileSize,
                lastModified: item.lastModified,
                hasFile: true,
                chunks: item.chunks,
                duplicateMetadata: item.duplicateMetadata || existingItem.duplicateMetadata,
                phase:
                  existingItem.phase === "needs_file"
                    ? "paused"
                    : existingItem.phase,
                error:
                  existingItem.phase === "needs_file"
                    ? null
                    : existingItem.error,
              }
            : item,
        );
      });
      return {
        items: Array.from(itemMap.values()),
        activeItemId: nextItems[0]?.id || currentState.activeItemId,
      };
    });
  },
  selectItem(id: string) {
    setState((currentState) => ({ ...currentState, activeItemId: id }));
  },
  async start(id?: string) {
    const targetId = id || state.activeItemId;
    const item = state.items.find((currentItem) => currentItem.id === targetId);
    if (import.meta.env.DEV) {
      console.log("[large-upload-store:start]", {
        requestedId: id || null,
        targetId: targetId || null,
        found: Boolean(item),
        phase: item?.phase || null,
        fileName: item?.fileName || null,
        uploadSessionId: item?.uploadSessionId || null,
      });
    }
    if (!item || item.phase === "uploading" || item.phase === "merging") {
      if (import.meta.env.DEV) {
        console.log("[large-upload-store:start:skip]", {
          reason: !item ? "item-not-found" : `phase-${item.phase}`,
          targetId: targetId || null,
        });
      }
      return;
    }
    const isResumeFromPaused =
      item.phase === "paused" || item.phase === "needs_file";

    const hasUploadedAllChunks =
      item.uploadedChunkIndexes.length === item.chunks.length ||
      item.progress >= 100;
    if (
      hasUploadedAllChunks ||
      item.phase === "ready_to_merge" ||
      item.phase === "merge_failed" ||
      item.phase === "success"
    ) {
      if (import.meta.env.DEV) {
        console.log("[large-upload-store:start:completion-branch]", {
          id: item.id,
          fileName: item.fileName,
          phase: item.phase,
          hasUploadedAllChunks,
          uploadSessionId: item.uploadSessionId || null,
        });
      }
      if (item.uploadSessionId && item.phase !== "success" && item.phase !== "merge_failed") {
        try {
          await reconcileUploadCompletion(item);
        } catch (error) {
          updateItem(item.id, {
            phase: "upload_failed",
            error: getErrorMessage(error) || "Không thể xác nhận trạng thái upload",
            speedBps: 0,
          });
        }
      } else {
        updateItem(item.id, {
          phase: item.phase === "merge_failed" ? "merge_failed" : "ready_to_merge",
          progress: 100,
          uploadedChunks: item.chunks.length,
          speedBps: 0,
        });
      }
      return;
    }

    if (state.activeItemId !== item.id) {
      state = { ...state, activeItemId: item.id };
    }

    try {
      if (!item.hasFile && isResumeFromPaused) {
        updateItem(item.id, {
          phase: "needs_file",
          error: "Cần chọn lại file để tiếp tục upload.",
          speedBps: 0,
        });
        return;
      }
      const sessionItem = await ensureSession(item);
      if (isResumeFromPaused) {
        if (!sessionItem.uploadSessionId) {
          updateItem(item.id, {
            phase: "paused",
            error: "Không tìm thấy upload session để tiếp tục.",
            speedBps: 0,
          });
          return;
        }

        if (resumeInFlightSessionIds.has(sessionItem.uploadSessionId)) return;
        resumeInFlightSessionIds.add(sessionItem.uploadSessionId);
        console.info("[chunked-resume] request start", {
          sessionId: sessionItem.uploadSessionId,
        });
        try {
          await resumeChunkedUpload(sessionItem.uploadSessionId);
          console.info("[chunked-resume] response=200", {
            sessionId: sessionItem.uploadSessionId,
          });
        } finally {
          resumeInFlightSessionIds.delete(sessionItem.uploadSessionId);
        }
      }

      isPaused = false;
      activeWorkers = 0;
      abortController = new AbortController();
      const runId = ++uploadRunId;
      lastSpeedTime = Date.now();
      lastSpeedBytes = 0;
      totalBytesUploaded = sessionItem.uploadedChunkIndexes.reduce(
        (total, chunkIndex) => total + (sessionItem.chunks[chunkIndex]?.size || 0),
        0,
      );

      updateItem(sessionItem.id, { phase: "uploading", speedBps: 0, error: null });
      pendingChunkIndexes = sessionItem.chunks
        .map((chunk) => chunk.index)
        .filter((chunkIndex) => !sessionItem.uploadedChunkIndexes.includes(chunkIndex));
      if (pendingChunkIndexes.length === 0) {
        await reconcileUploadCompletion(sessionItem);
      } else {
        if (isResumeFromPaused) {
          console.info("[chunked-resume] restart workers", {
            sessionId: sessionItem.uploadSessionId,
            uploaded: `${sessionItem.uploadedChunkIndexes.length}/${sessionItem.chunks.length}`,
          });
        }
        processQueue(runId, abortController);
      }
    } catch (error) {
      updateItem(item.id, {
        phase: isResumeFromPaused ? "paused" : "upload_failed",
        error: getErrorMessage(error) || (
          isResumeFromPaused
            ? "Không thể tiếp tục upload"
            : "Không thể khởi tạo upload session"
        ),
        speedBps: 0,
      });
    }
  },
  pause() {
    const item = getActiveItem();
    if (!item || item.phase !== "uploading") return;
    isPaused = true;
    abortController?.abort();
    uploadRunId++;
    updateItem(item.id, { phase: "paused", speedBps: 0 });
    if (item.uploadSessionId) pauseChunkedUpload(item.uploadSessionId).catch(() => {});
  },
  async resume() {
    const item = getActiveItem();
    if (!item || item.phase !== "paused") return;
    console.info("[chunked-resume] click", {
      sessionId: item.uploadSessionId,
      uploaded: `${item.uploadedChunkIndexes.length}/${item.chunks.length}`,
    });
    console.info("[chunked-resume] sessionId=", item.uploadSessionId);
    await largeUploadStore.start(item.id);
  },
  merge(id?: string) {
    const targetId = id || state.activeItemId;
    const item = state.items.find((currentItem) => currentItem.id === targetId);
    if (!item) return Promise.resolve(null);
    return mergeUpload(item);
  },
  markSaved(id?: string) {
    const targetId = id || state.activeItemId;
    if (!targetId) return;
    setState((currentState) => ({
      items: currentState.items.filter((item) => item.id !== targetId),
      activeItemId:
        currentState.activeItemId === targetId
          ? currentState.items.find((item) => item.id !== targetId)?.id || null
          : currentState.activeItemId,
    }));
  },
  cancel() {
    const item = getActiveItem();
    if (!item) return;
    isPaused = false;
    abortController?.abort();
    uploadRunId++;
    pendingChunkIndexes = [];
    activeWorkers = 0;
    totalBytesUploaded = 0;
    updateItem(item.id, {
      phase: "canceled",
      retryCount: 0,
      speedBps: 0,
      error: "Upload đã huỷ.",
    });
    if (item.uploadSessionId) cancelChunkedUpload(item.uploadSessionId).catch(() => {});
  },
  remove(id?: string) {
    const targetId = id || state.activeItemId;
    if (!targetId) return;
    setState((currentState) => ({
      items: currentState.items.filter((item) => item.id !== targetId),
      activeItemId:
        currentState.activeItemId === targetId
          ? currentState.items.find((item) => item.id !== targetId)?.id || null
          : currentState.activeItemId,
    }));
  },
};

export function useLargeUploadStore() {
  return useSyncExternalStore(
    largeUploadStore.subscribe,
    largeUploadStore.getSnapshot,
    largeUploadStore.getSnapshot,
  );
}
