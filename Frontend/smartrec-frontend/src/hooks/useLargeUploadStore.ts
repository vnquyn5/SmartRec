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
  | "ready_to_merge"
  | "merging"
  | "success"
  | "canceled"
  | "upload_failed"
  | "merge_failed";

export interface LargeUploadItem {
  id: string;
  file: File;
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
  lastModified: number;
  totalChunks: number;
  backendChunkSize: number | null;
  uploadedChunkIndexes: number[];
  phase: LargeUploadPhase;
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

const getFileKey = (file: File) =>
  `${file.name}-${file.size}-${file.lastModified}`;

const emit = () => listeners.forEach((listener) => listener());

const persist = () => {
  const payload = state.items
    .filter((item) => item.phase !== "success")
    .map<PersistedItem>((item) => ({
    id: item.id,
    uploadSessionId: item.uploadSessionId,
    fileName: item.file.name,
    fileSize: item.file.size,
    lastModified: item.file.lastModified,
    totalChunks: item.chunks.length,
    backendChunkSize: item.backendChunkSize,
    uploadedChunkIndexes: item.uploadedChunkIndexes,
    phase: item.phase,
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
    return "ready_to_merge";
  }
  if (phase === "uploading") return "paused";
  if (phase === "merging") return "ready_to_merge";
  return phase || "idle";
};

const buildItem = (file: File): LargeUploadItem => {
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
  };
};

const ensureSession = async (item: LargeUploadItem) => {
  if (item.uploadSessionId) return item;

  const initResponse = await initChunkedUpload({
    fileName: item.file.name,
    fileSize: item.file.size,
    totalChunks: item.chunks.length,
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
    updateItem(item.id, {
      phase: status.status === "MERGING"
        ? "merging"
        : status.status === "COMPLETED"
          ? "success"
          : "ready_to_merge",
      progress: 100,
      uploadedChunks: item.chunks.length,
      retryCount: 0,
      error: null,
      speedBps: 0,
    });
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
  if (latestItem?.phase === "success") return latestItem;
  if (
    !latestItem ||
    !latestItem.uploadSessionId ||
    latestItem.mergeStarted ||
    latestItem.uploadedChunkIndexes.length !== latestItem.chunks.length
  ) {
    return null;
  }

  updateItem(latestItem.id, {
    phase: "merging",
    mergeStarted: true,
    speedBps: 0,
    error: null,
  });
  try {
    const mergeResponse = await mergeChunkedUpload(
      latestItem.uploadSessionId,
      latestItem.file.name,
    );
    if (mergeResponse.status === "MERGING") {
      await pollMergeStatus(latestItem.id, latestItem.uploadSessionId);
    }
    updateItem(latestItem.id, {
      phase: "success",
      progress: 100,
      uploadedChunks: latestItem.chunks.length,
      speedBps: 0,
      mergeResponse,
    });
    return {
      ...latestItem,
      phase: "success" as LargeUploadPhase,
      progress: 100,
      uploadedChunks: latestItem.chunks.length,
      speedBps: 0,
      mergeResponse,
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
  const startedAt = Date.now();
  while (Date.now() - startedAt < MERGE_POLL_TIMEOUT_MS) {
    await new Promise((resolve) =>
      window.setTimeout(resolve, MERGE_POLL_INTERVAL_MS),
    );

    const currentItem = state.items.find((item) => item.id === itemId);
    if (!currentItem || currentItem.phase !== "merging") return;

    const statusResponse = await getChunkedUploadStatus(uploadSessionId);
    if (statusResponse.status === "COMPLETED") return;
    if (
      statusResponse.status === "FAILED" ||
      statusResponse.status === "MERGE_FAILED" ||
      statusResponse.status === "CANCELLED"
    ) {
      throw new Error("Merge upload thất bại. Bạn có thể thử lại merge.");
    }
  }

  throw new Error("Merge upload chưa hoàn tất sau thời gian chờ.");
};

export const largeUploadStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return state;
  },
  addFiles(files: File[]) {
    const nextItems = files.map(buildItem);

    setState((currentState) => {
      const itemMap = new Map(currentState.items.map((item) => [item.id, item]));
      nextItems.forEach((item) => {
        const existingItem = itemMap.get(item.id);
        itemMap.set(item.id, existingItem ? { ...existingItem, file: item.file } : item);
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
    if (!item || item.phase === "uploading" || item.phase === "merging") return;

    const hasUploadedAllChunks =
      item.uploadedChunkIndexes.length === item.chunks.length ||
      item.progress >= 100;
    if (
      hasUploadedAllChunks ||
      item.phase === "ready_to_merge" ||
      item.phase === "merge_failed" ||
      item.phase === "success"
    ) {
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

    isPaused = false;
    activeWorkers = 0;
    abortController = new AbortController();
    const runId = ++uploadRunId;
    lastSpeedTime = Date.now();
    lastSpeedBytes = 0;
    totalBytesUploaded = item.uploadedChunkIndexes.reduce(
      (total, chunkIndex) => total + (item.chunks[chunkIndex]?.size || 0),
      0,
    );

    updateItem(item.id, { phase: "uploading", speedBps: 0, error: null });

    try {
      const sessionItem = await ensureSession(item);
      pendingChunkIndexes = sessionItem.chunks
        .map((chunk) => chunk.index)
        .filter((chunkIndex) => !sessionItem.uploadedChunkIndexes.includes(chunkIndex));
      if (pendingChunkIndexes.length === 0) {
        await reconcileUploadCompletion(sessionItem);
      } else {
        if (item.uploadSessionId) {
          await resumeChunkedUpload(item.uploadSessionId);
        }
        processQueue(runId, abortController);
      }
    } catch (error) {
      updateItem(item.id, {
        phase: "upload_failed",
        error: getErrorMessage(error) || "Không thể khởi tạo upload session",
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
  resume() {
    const item = getActiveItem();
    if (!item || item.phase !== "paused") return;
    this.start(item.id);
  },
  merge(id?: string) {
    const targetId = id || state.activeItemId;
    const item = state.items.find((currentItem) => currentItem.id === targetId);
    if (!item) return Promise.resolve(null);
    return mergeUpload(item);
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
};

export function useLargeUploadStore() {
  return useSyncExternalStore(
    largeUploadStore.subscribe,
    largeUploadStore.getSnapshot,
    largeUploadStore.getSnapshot,
  );
}
