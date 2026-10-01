import { useSyncExternalStore } from "react";
import { uploadSingleFile } from "../features/files/useSingleUpload";

const STORAGE_KEY = "smartrec.singleUpload.sessions.v1";
const listeners = new Set();

const readPersisted = () => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
};

const createFilePlaceholder = (item) => ({
  name: item.fileName,
  size: item.fileSize,
  lastModified: item.lastModified,
  type: item.fileType || "application/octet-stream",
});

let state = {
  items: readPersisted().map((item) => ({
    ...item,
    file: createFilePlaceholder(item),
    hasFile: false,
    phase: ["uploading", "finalizing"].includes(item.phase) ? "error" : item.phase,
    progress: item.progress || 0,
    uploadedBytes: item.uploadedBytes || 0,
    speedBps: 0,
    error:
      ["uploading", "finalizing"].includes(item.phase)
        ? "Upload bị gián đoạn. Cần chọn lại file để thử lại."
        : item.error || null,
    abortController: null,
  })),
};

const emit = () => listeners.forEach((listener) => listener());

const setState = (updater) => {
  state = updater(state);
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      state.items.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        fileSize: item.fileSize,
        fileType: item.file?.type,
        lastModified: item.lastModified,
        strategy: "single",
        phase: item.phase,
        progress: item.progress,
        uploadedBytes: item.uploadedBytes,
        error: item.error,
        completedAt: item.phase === "success" ? new Date().toISOString() : null,
      })),
    ),
  );
  emit();
};

const updateItem = (id, updates) => {
  setState((currentState) => ({
    ...currentState,
    items: currentState.items.map((item) =>
      item.id === id ? { ...item, ...updates } : item,
    ),
  }));
};

const buildItem = (file, duplicateMetadata = null) => ({
  id: `${file.name}-${file.size}-${file.lastModified}`,
  file,
  fileName: file.name,
  fileSize: file.size,
  fileType: file.type,
  lastModified: file.lastModified,
  hasFile: true,
  strategy: "single",
  chunkInfo: null,
  phase: "idle",
  progress: 0,
  uploadedBytes: 0,
  speedBps: 0,
  error: null,
  saved: false,
  uploadResponse: null,
  duplicateMetadata,
  abortController: null,
});

const startUpload = async (itemId, meetingName = "") => {
  const item = state.items.find((currentItem) => currentItem.id === itemId);
  if (!item || item.phase === "uploading" || item.phase === "finalizing") return;
  if (!item.hasFile) {
    updateItem(item.id, {
      phase: "error",
      progress: 0,
      uploadedBytes: 0,
      speedBps: 0,
      error: "Cần chọn lại file để thử lại.",
    });
    return;
  }

  const controller = new AbortController();
  let lastLoaded = 0;
  let lastTime = Date.now();

  updateItem(item.id, {
    phase: "uploading",
    progress: 0,
    uploadedBytes: 0,
    speedBps: 0,
    error: null,
    uploadResponse: null,
    abortController: controller,
  });

  try {
    const uploadResponse = await uploadSingleFile(
      item.file,
      meetingName,
      item.duplicateMetadata,
      controller.signal,
      (event) => {
        if (!event.total) return;

        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        const updates = {
          progress: Math.round((event.loaded / event.total) * 100),
          uploadedBytes: event.loaded,
        };

        if (timeDiff >= 0.5) {
          const bytesDiff = event.loaded - lastLoaded;
          if (bytesDiff > 0) updates.speedBps = bytesDiff / timeDiff;
          lastTime = now;
          lastLoaded = event.loaded;
        }

        updateItem(item.id, updates);
      },
      () => {
        updateItem(item.id, {
          phase: "finalizing",
          progress: 100,
          uploadedBytes: item.file.size,
          speedBps: 0,
        });
      },
    );

    updateItem(item.id, {
      phase: "success",
      progress: 100,
      uploadedBytes: item.file.size,
      speedBps: 0,
      uploadResponse,
      abortController: null,
    });
  } catch (error) {
    const isCanceled = error?.kind === "canceled" || error?.message === "canceled";
    const latestItem =
      state.items.find((currentItem) => currentItem.id === item.id) || item;
    updateItem(item.id, {
      phase: isCanceled ? "canceled" : "error",
      progress: isCanceled ? 0 : latestItem.progress,
      uploadedBytes: isCanceled ? 0 : latestItem.uploadedBytes,
      speedBps: 0,
      error: isCanceled ? "Đã huỷ" : error?.message || "Upload thất bại",
      abortController: null,
    });
  }
};

export const singleUploadStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return state;
  },
  addFiles(files, meetingName = "", duplicateMetadataById = {}) {
    const items = files.map((file) =>
      buildItem(file, duplicateMetadataById[`${file.name}-${file.size}-${file.lastModified}`] || null),
    );
    setState((currentState) => ({
      ...currentState,
      items: [
        ...currentState.items.filter(
          (currentItem) => !items.some((item) => item.id === currentItem.id),
        ),
        ...items,
      ],
    }));
    items.forEach((item) => {
      window.setTimeout(() => startUpload(item.id, meetingName), 0);
    });
  },
  start(id, meetingName = "") {
    return startUpload(id, meetingName);
  },
  cancel(id) {
    const item = state.items.find((currentItem) => currentItem.id === id);
    if (!item || item.phase === "success") return;
    item.abortController?.abort();
    updateItem(id, {
      phase: "canceled",
      progress: 0,
      uploadedBytes: 0,
      speedBps: 0,
      error: "Đã huỷ",
      abortController: null,
    });
  },
  retry(id, meetingName = "") {
    updateItem(id, {
      phase: "idle",
      progress: 0,
      uploadedBytes: 0,
      speedBps: 0,
      error: null,
      uploadResponse: null,
      abortController: null,
    });
    return startUpload(id, meetingName);
  },
  remove(id) {
    setState((currentState) => ({
      ...currentState,
      items: currentState.items.filter((currentItem) => currentItem.id !== id),
    }));
  },
  markSaved(id) {
    setState((currentState) => ({
      ...currentState,
      items: currentState.items.filter((item) => item.id !== id),
    }));
  },
  setSaveError(id, saveError) {
    updateItem(id, { saveError });
  },
};

export function useSingleUploadStore() {
  return useSyncExternalStore(
    singleUploadStore.subscribe,
    singleUploadStore.getSnapshot,
    singleUploadStore.getSnapshot,
  );
}
