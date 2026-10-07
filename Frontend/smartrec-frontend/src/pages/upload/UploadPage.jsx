import React, { useRef, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  largeUploadStore,
  useLargeUploadStore,
} from "../../hooks/useLargeUploadStore";
import {
  singleUploadStore,
  useSingleUploadStore,
} from "../../hooks/useSingleUploadStore";
import { saveFileHandle } from "../../services/fileHandleStorage";
import {
  pickFilesWithPersistentHandles,
  restoreChunkedFile,
  restoreFileFromHandle,
} from "../../services/uploadRecovery";
import { getMediaDuration } from "../../utils/fileSlice";
import {
  buildUploadDuplicateNotice,
  checkFilesForUploadDuplicates,
} from "../../utils/uploadDuplicateNotice";

// Helper format bytes
const formatBytes = (bytes) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const formatDuration = (seconds) => {
  if (!seconds || !isFinite(seconds)) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const formatCompletedAt = (value) => {
  const date = value ? new Date(value) : new Date();
  return `${date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })} ${date.toLocaleDateString("vi-VN")}`;
};

// Allowed extensions
const ALLOWED_EXTENSIONS = ["mp4", "mkv", "mp3", "m4a"];
const MAX_SINGLE_FILES = 5;
const MAX_CHUNKED_FILES = 3;
const SINGLE_UPLOAD_LIMIT = 2 * 1024 * 1024 * 1024;
const CHUNKED_UPLOAD_LIMIT = 5 * 1024 * 1024 * 1024;

// Kiểm tra extension hợp lệ
const isValidExtension = (fileName) => {
  const ext = fileName.split(".").pop().toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
};

const getFileIdentity = (file) =>
  `${file.name}-${file.size}-${file.lastModified}`;

const buildQueueIdentitySet = (singleItems, chunkedItems) =>
  new Set([
    ...singleItems
      .filter((item) => item.hasFile !== false)
      .map(
        (item) =>
          `${item.fileName || item.file?.name}-${item.fileSize || item.file?.size}-${item.file?.lastModified || item.lastModified || ""}`,
      ),
    ...chunkedItems
      .filter((item) => item.hasFile !== false)
      .map(
        (item) =>
          `${item.fileName || item.file?.name}-${item.fileSize || item.file?.size}-${item.file?.lastModified || item.lastModified || ""}`,
      ),
  ]);

const UploadPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const pendingRecoveryItemIdRef = useRef(null);
  const singleUploadState = useSingleUploadStore();
  const largeUploadState = useLargeUploadStore();

  const [meetingName, setMeetingName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [savedNotification, setSavedNotification] = useState(null);
  const [uploadNotice, setUploadNotice] = useState(null);
  const [savedFilesSummary, setSavedFilesSummary] = useState([]);
  const [durationByFileId, setDurationByFileId] = useState({});
  const [savingIds, setSavingIds] = useState(() => new Set());
  const [isSavingAll, setIsSavingAll] = useState(false);
  const savingIdsRef = useRef(new Set());
  const isSavingAllRef = useRef(false);
  const shownChunkedSuccessIdsRef = useRef(new Set());
  const queue = singleUploadState.items;

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("[duplicate-notice:state]", uploadNotice);
    }
  }, [uploadNotice]);

  // Xử lý thêm file(s) vào queue
  const addFilesToQueue = useCallback(
    async (files, handlesByFile = new Map()) => {
      const fileArray = Array.from(files);

      const validFiles = [];
      for (const file of fileArray) {
        if (!isValidExtension(file.name)) {
          setUploadNotice(
            `File "${file.name}" không được hỗ trợ và đã được bỏ qua.`,
          );
          continue;
        }
        if (file.size > CHUNKED_UPLOAD_LIMIT) {
          setUploadNotice(
            `File "${file.name}" vượt quá giới hạn 5GB và đã được bỏ qua.`,
          );
          continue;
        }
        validFiles.push(file);
      }

      const uniqueFiles = [];
      const seenSelectionKeys = new Set();
      const queueKeys = buildQueueIdentitySet(
        singleUploadState.items,
        largeUploadState.items,
      );
      const skippedSelectionDuplicates = [];
      const skippedQueueDuplicates = [];

      for (const file of validFiles) {
        const identity = getFileIdentity(file);
        if (seenSelectionKeys.has(identity)) {
          skippedSelectionDuplicates.push(file.name);
          continue;
        }
        seenSelectionKeys.add(identity);
        if (queueKeys.has(identity)) {
          skippedQueueDuplicates.push(file.name);
          continue;
        }
        uniqueFiles.push(file);
      }

      let existingByIdentity = new Map();
      let metadataByIdentity = new Map();
      let existingFiles = [];
      let uploadableFiles = [];
      try {
        const duplicateCheckResult = await checkFilesForUploadDuplicates(
          uniqueFiles,
          {
            getIdentity: getFileIdentity,
            forceFullChecksum: (file) => file.size > SINGLE_UPLOAD_LIMIT,
          },
        );
        existingByIdentity = duplicateCheckResult.duplicatesByIdentity;
        metadataByIdentity = duplicateCheckResult.metadataByIdentity;
        existingFiles = duplicateCheckResult.duplicateItems;
        uploadableFiles = duplicateCheckResult.uploadableFiles;
        if (import.meta.env.DEV) {
          console.log("[upload-page:duplicate-result]", {
            totalUniqueFiles: uniqueFiles.length,
            duplicates: existingFiles.map(({ file, duplicate }) => ({
              selectedFileName: file.name,
              selectedFileSize: file.size,
              existingFileName: duplicate.existingFileName,
              mediaFileId: duplicate.mediaFileId,
            })),
            uploadableFiles: uploadableFiles.map((file) => ({
              fileName: file.name,
              fileSize: file.size,
            })),
          });
        }
      } catch (error) {
        setUploadNotice(
          "Không thể kiểm tra file trùng từ hệ thống. Vui lòng thử lại.",
        );
        return;
      }

      if (uploadableFiles.length > 0) {
        const durationEntries = await Promise.all(
          uploadableFiles.map(async (file) => {
            try {
              return [getFileIdentity(file), await getMediaDuration(file)];
            } catch {
              return [getFileIdentity(file), null];
            }
          }),
        );
        setDurationByFileId((current) => ({
          ...current,
          ...Object.fromEntries(durationEntries),
        }));
      }

      const singleFiles = [];
      const chunkedFiles = [];
      for (const file of uploadableFiles) {
        if (file.size <= SINGLE_UPLOAD_LIMIT) {
          singleFiles.push(file);
        } else {
          chunkedFiles.push(file);
        }
      }
      if (import.meta.env.DEV) {
        console.log("[upload-page:split-after-duplicate]", {
          uploadableCount: uploadableFiles.length,
          singleFiles: singleFiles.map((file) => ({
            fileName: file.name,
            fileSize: file.size,
          })),
          chunkedFiles: chunkedFiles.map((file) => ({
            fileName: file.name,
            fileSize: file.size,
          })),
        });
      }

      const activeSingleCount = singleUploadState.items.filter((item) =>
        ["idle", "uploading", "finalizing", "paused"].includes(item.phase),
      ).length;
      const availableSingleSlots = MAX_SINGLE_FILES - activeSingleCount;
      const originalSingleCount = singleFiles.length;

      if (singleFiles.length > availableSingleSlots) {
        singleFiles.splice(Math.max(0, availableSingleSlots));
      }

      const activeChunkedCount = largeUploadState.items.filter((item) =>
        ["idle", "uploading", "paused", "ready_to_merge", "merging"].includes(
          item.phase,
        ),
      ).length;
      const availableChunkedSlots = MAX_CHUNKED_FILES - activeChunkedCount;
      const originalChunkedCount = chunkedFiles.length;
      if (import.meta.env.DEV) {
        console.log("[upload-page:chunked-slots]", {
          activeChunkedCount,
          availableChunkedSlots,
          selectedChunkedCount: originalChunkedCount,
          currentChunkedItems: largeUploadState.items.map((item) => ({
            id: item.id,
            fileName: item.fileName,
            phase: item.phase,
            hasFile: item.hasFile,
            uploadSessionId: item.uploadSessionId || null,
          })),
        });
      }

      if (chunkedFiles.length > availableChunkedSlots) {
        chunkedFiles.splice(Math.max(0, availableChunkedSlots));
      }

      if (
        singleFiles.length < originalSingleCount ||
        chunkedFiles.length < originalChunkedCount ||
        existingFiles.length > 0 ||
        skippedSelectionDuplicates.length > 0 ||
        skippedQueueDuplicates.length > 0
      ) {
        const messageParts = [];
        if (skippedSelectionDuplicates.length > 0) {
          messageParts.push(
            `${skippedSelectionDuplicates.length} file trùng trong lựa chọn được bỏ qua`,
          );
        }
        if (skippedQueueDuplicates.length > 0) {
          messageParts.push(
            `${skippedQueueDuplicates.length} file đã có trong hàng chờ được bỏ qua`,
          );
        }
        if (originalSingleCount > 0) {
          messageParts.push(
            `Đã chọn ${singleFiles.length}/${originalSingleCount} file thường`,
          );
        }
        if (originalChunkedCount > 0) {
          messageParts.push(
            `Đã chọn ${chunkedFiles.length}/${originalChunkedCount} file lớn`,
          );
        }
        if (messageParts.length > 0) {
          setUploadNotice(`${messageParts.join(". ")} theo giới hạn cho phép.`);
          window.setTimeout(() => setUploadNotice(null), 3500);
        }
      }

      if (existingFiles.length > 0) {
        const notice = buildUploadDuplicateNotice(
          existingFiles.map(({ duplicate }) => duplicate.existingFileName),
          uniqueFiles.length,
        );
        if (import.meta.env.DEV) {
          console.log("[duplicate-notice:set]", notice);
        }
        setUploadNotice(notice);
      }

      if (uploadableFiles.length === 0) {
        if (import.meta.env.DEV) {
          console.log("[upload-page:stop-before-queue]", {
            reason: "no-uploadable-files",
            duplicateCount: existingFiles.length,
          });
        }
        return;
      }

      if (singleFiles.length > 0) {
        if (import.meta.env.DEV) {
          console.log("[upload-page:add-single-files]", {
            files: singleFiles.map((file) => ({
              fileName: file.name,
              fileSize: file.size,
            })),
          });
        }
        singleUploadStore.addFiles(
          singleFiles,
          meetingName,
          Object.fromEntries(
            singleFiles.map((file) => [
              getFileIdentity(file),
              metadataByIdentity.get(getFileIdentity(file)) || null,
            ]),
          ),
        );
      }

      if (chunkedFiles.length > 0) {
        const chunkedIds = chunkedFiles.map(
          (file) => `${file.name}-${file.size}-${file.lastModified}`,
        );
        if (import.meta.env.DEV) {
          console.log("[upload-page:add-chunked-files]", {
            files: chunkedFiles.map((file) => ({
              fileName: file.name,
              fileSize: file.size,
              id: `${file.name}-${file.size}-${file.lastModified}`,
              duplicateMetadata:
                metadataByIdentity.get(getFileIdentity(file)) || null,
            })),
          });
        }
        const duplicateMetadataById = Object.fromEntries(
          chunkedFiles.map((file) => [
            getFileIdentity(file),
            metadataByIdentity.get(getFileIdentity(file)) || null,
          ]),
        );
        const chunkedSelections = chunkedFiles.map((file) => ({
          file,
          handle: handlesByFile.get(file),
        }));
        if (chunkedSelections.some(({ handle }) => handle)) {
          await largeUploadStore.addFilesWithHandles(
            chunkedSelections,
            duplicateMetadataById,
          );
        } else {
          largeUploadStore.addFiles(chunkedFiles, duplicateMetadataById);
        }
        const hasActiveChunkedUpload = largeUploadState.items.some((item) =>
          ["uploading", "merging"].includes(item.phase),
        );
        if (import.meta.env.DEV) {
          console.log("[upload-page:chunked-autostart]", {
            hasActiveChunkedUpload,
            startId: chunkedIds[0] || null,
          });
        }
        if (!hasActiveChunkedUpload) {
          window.setTimeout(() => largeUploadStore.start(chunkedIds[0]), 0);
        }
      }
    },
    [largeUploadState.items, meetingName, singleUploadState.items],
  );

  // Xử lý chọn file qua input
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const pendingId = pendingRecoveryItemIdRef.current;
      const selectedFile = e.target.files[0];
      if (pendingId) {
        pendingRecoveryItemIdRef.current = null;
        const chunkItem = largeUploadStore
          .getSnapshot()
          .items.find((candidate) => candidate.id === pendingId);
        const singleItem = singleUploadStore
          .getSnapshot()
          .items.find((candidate) => candidate.id === pendingId);
        const item = chunkItem || singleItem;
        if (
          item &&
          selectedFile.name === item.fileName &&
          selectedFile.size === item.fileSize &&
          (!item.lastModified ||
            selectedFile.lastModified === item.lastModified)
        ) {
          if (chunkItem) {
            largeUploadStore.reattachFileToExistingItem(item.id, selectedFile);
            largeUploadStore.setRecoveryCheckPending(item.id, false);
            largeUploadStore
              .refreshStatus(item.id)
              .finally(() => largeUploadStore.start(item.id));
          } else {
            singleUploadStore.attachRecoveredFile(item.id, selectedFile);
            singleUploadStore.retry(item.id, meetingName);
          }
          e.target.value = "";
          return;
        }
        setUploadNotice(
          "File được chọn không khớp với upload đang chờ khôi phục.",
        );
        e.target.value = "";
        return;
      }
      if (import.meta.env.DEV) {
        Array.from(e.target.files).forEach((file) => {
          console.info("[upload-picker]", {
            source: "input",
            fileName: file.name,
            hasHandle: false,
          });
        });
      }
      addFilesToQueue(e.target.files);
      e.target.value = "";
    }
  };

  const handleChooseFiles = async () => {
    const picked = await pickFilesWithPersistentHandles();
    if (picked === null) {
      if (import.meta.env.DEV) {
        console.info("[upload-picker]", { source: "input", hasHandle: false });
      }
      fileInputRef.current?.click();
      return;
    }
    if (picked.length === 0) return;
    if (import.meta.env.DEV) {
      picked.forEach(({ file, handle }) =>
        console.info("[upload-picker]", {
          source: "file-system-access",
          fileName: file.name,
          hasHandle: Boolean(handle),
        }),
      );
    }
    const handlesByFile = new Map(
      picked.map(({ file, handle }) => [file, handle]),
    );
    await addFilesToQueue(
      picked.map(({ file }) => file),
      handlesByFile,
    );
    const singleItems = singleUploadStore.getSnapshot().items;
    await Promise.all(
      picked.map(async ({ file, handle }) => {
        if (file.size > SINGLE_UPLOAD_LIMIT) return;
        const identity = getFileIdentity(file);
        const singleItem = singleItems.find((item) => item.id === identity);
        const recoveryKey = singleItem?.id;
        if (!recoveryKey) {
          return;
        }
        await saveFileHandle(recoveryKey, handle).catch(() => {});
      }),
    );
  };

  // Xử lý kéo thả
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const transferItems = Array.from(e.dataTransfer.items || []);
    Promise.all(
      transferItems
        .filter((item) => item.kind === "file")
        .map(async (transferItem) => {
          if (typeof transferItem.getAsFileSystemHandle === "function") {
            try {
              const handle = await transferItem.getAsFileSystemHandle();
              if (handle?.kind === "file")
                return { file: await handle.getFile(), handle };
            } catch {
              /* Fall through to the standard dropped File. */
            }
          }
          return { file: transferItem.getAsFile(), handle: undefined };
        }),
    ).then((selections) => {
      const validSelections = selections.filter(({ file }) => file);
      const files = validSelections.map(({ file }) => file);
      const handlesByFile = new Map(
        validSelections
          .filter(({ handle }) => handle)
          .map(({ file, handle }) => [file, handle]),
      );
      if (import.meta.env.DEV) {
        validSelections.forEach(({ file, handle }) =>
          console.info("[upload-picker]", {
            source: "drag-drop",
            fileName: file.name,
            hasHandle: Boolean(handle),
          }),
        );
      }
      if (files.length) addFilesToQueue(files, handlesByFile);
    });
  };

  const removeItemFromUI = useCallback((item) => {
    if (item.strategy === "chunk") {
      largeUploadStore.remove(item.id);
      return;
    }
    singleUploadStore.remove(item.id);
  }, []);

  const handlePauseFile = useCallback((id, strategy = "single") => {
    if (strategy === "chunk") {
      largeUploadStore.selectItem(id);
      largeUploadStore.pause();
    }
  }, []);

  const handleCancelFile = useCallback(
    (id, strategy = "single") => {
      if (strategy === "chunk") {
        largeUploadStore.selectItem(id);
        largeUploadStore.cancel();
        return;
      }

      const item = singleUploadState.items.find(
        (queueItem) => queueItem.id === id,
      );
      if (!item || item.phase === "success") return;
      singleUploadStore.cancel(id);
    },
    [singleUploadState.items],
  );

  const handleRetryFile = useCallback(
    async (item) => {
      let retryItem = item;
      if (retryItem.strategy === "chunk") {
        largeUploadStore.selectItem(item.id);
        const mergeOrCompletePhases = [
          "ready_to_merge",
          "merging",
          "success",
          "merge_failed",
        ];
        if (mergeOrCompletePhases.includes(retryItem.phase)) {
          if (retryItem.uploadSessionId) {
            await largeUploadStore.refreshStatus(item.id).catch(() => {});
            retryItem =
              largeUploadStore
                .getSnapshot()
                .items.find((candidate) => candidate.id === item.id) ||
              retryItem;
          }
          if (retryItem.phase === "ready_to_merge")
            largeUploadStore.start(item.id);
          return;
        }

        if (retryItem.hasFile === false) {
          const result = await restoreChunkedFile(retryItem, true);
          if (result.file) {
            largeUploadStore.reattachFileToExistingItem(item.id, result.file);
            largeUploadStore.setRecoveryCheckPending(item.id, false);
            retryItem =
              largeUploadStore
                .getSnapshot()
                .items.find((candidate) => candidate.id === item.id) ||
              retryItem;
          } else if (result.reason === "PERMISSION_REQUIRED") {
            largeUploadStore.setRecoveryPermissionRequired(item.id, true);
            return;
          }
        }

        if (retryItem.uploadSessionId) {
          await largeUploadStore.refreshStatus(item.id).catch(() => {});
          retryItem =
            largeUploadStore
              .getSnapshot()
              .items.find((candidate) => candidate.id === item.id) || retryItem;
        }
        if (
          ["ready_to_merge", "merging", "success", "merge_failed"].includes(
            retryItem.phase,
          )
        ) {
          if (retryItem.phase === "ready_to_merge")
            largeUploadStore.start(item.id);
          return;
        }
        if (retryItem.hasFile === false) {
          pendingRecoveryItemIdRef.current = retryItem.id;
          fileInputRef.current?.click();
          return;
        }
        largeUploadStore.start(retryItem.id);
        return;
      }

      if (retryItem.hasFile === false) {
        const file = await restoreFileFromHandle(retryItem, true);
        if (file) singleUploadStore.attachRecoveredFile(item.id, file);
        else {
          pendingRecoveryItemIdRef.current = retryItem.id;
          fileInputRef.current?.click();
          return;
        }
      }
      singleUploadStore.retry(retryItem.id, meetingName);
    },
    [meetingName, navigate],
  );

  // The upload API already persists the file; saving here confirms it locally.
  const persistFile = useCallback(async (item) => {
    if (item.phase !== "success") {
      throw new Error("File chưa tải lên thành công");
    }
    return true;
  }, []);

  const buildSavedSummary = useCallback(
    (item, completedAt = new Date().toISOString()) => ({
      id: item.id,
      fileName:
        item.uploadResponse?.fileName ||
        item.mergeResponse?.fileName ||
        item.fileName ||
        item.file?.name ||
        "File không tên",
      fileSize: item.fileSize || item.file?.size || 0,
      duration:
        item.uploadResponse?.durationSeconds ??
        item.mergeResponse?.durationSeconds ??
        durationByFileId[item.id] ??
        durationByFileId[
          `${item.fileName || item.file?.name}-${item.fileSize || item.file?.size}-${item.lastModified || item.file?.lastModified || ""}`
        ] ??
        null,
      completedAt,
      uploadType: item.strategy === "chunk" ? "CHUNKED" : "SINGLE",
    }),
    [durationByFileId],
  );

  useEffect(() => {
    const completedChunkedItems = largeUploadState.items.filter((item) => {
      const successKey = item.uploadSessionId || item.id;
      return (
        item.phase === "success" &&
        item.saveRequested &&
        !item.saved &&
        !shownChunkedSuccessIdsRef.current.has(successKey)
      );
    });
    if (completedChunkedItems.length === 0) return;

    const summaries = completedChunkedItems.map((item) =>
      buildSavedSummary(
        {
          ...item,
          strategy: "chunk",
          fileName: item.fileName || item.file?.name,
          fileSize: item.fileSize || item.file?.size,
          lastModified: item.lastModified || item.file?.lastModified,
        },
        item.completedAt || new Date().toISOString(),
      ),
    );

    completedChunkedItems.forEach((item) => {
      shownChunkedSuccessIdsRef.current.add(item.uploadSessionId || item.id);
    });
    setSavedFilesSummary((current) => [...current, ...summaries]);
    completedChunkedItems.forEach((item) =>
      largeUploadStore.markSaved(item.id),
    );
  }, [buildSavedSummary, largeUploadState.items]);

  const handleSaveFile = useCallback(
    async (id) => {
      if (isSavingAllRef.current || savingIdsRef.current.has(id)) return;

      const singleItem = singleUploadState.items.find(
        (queueItem) => queueItem.id === id,
      );
      const chunkItem = largeUploadState.items.find(
        (queueItem) => queueItem.id === id,
      );
      const item = singleItem || chunkItem;
      if (!item) return;

      savingIdsRef.current.add(id);
      setSavingIds(new Set(savingIdsRef.current));

      try {
        if (singleItem) {
          if (singleItem.phase !== "success") return;
          await persistFile(singleItem);
          const summary = buildSavedSummary(singleItem);
          setSavedFilesSummary([summary]);
          singleUploadStore.markSaved(id);
        } else {
          if (chunkItem.phase === "success") {
            const summary = buildSavedSummary(
              {
                ...chunkItem,
                strategy: "chunk",
                fileName: chunkItem.fileName || chunkItem.file?.name,
                fileSize: chunkItem.fileSize || chunkItem.file?.size,
                lastModified:
                  chunkItem.lastModified || chunkItem.file?.lastModified,
              },
              chunkItem.completedAt || new Date().toISOString(),
            );
            setSavedFilesSummary([summary]);
            largeUploadStore.markSaved(id);
            return;
          }

          const canMerge =
            chunkItem.phase === "ready_to_merge" ||
            chunkItem.phase === "merging" ||
            (chunkItem.phase === "merge_failed" &&
              chunkItem.uploadedChunkIndexes.length ===
                chunkItem.chunks.length &&
              !chunkItem.mergeStarted);
          if (!canMerge) return;
          largeUploadStore.selectItem(id);
          const savedItem = await largeUploadStore.merge(id);
          if (savedItem?.phase === "success") {
            setSavedFilesSummary([
              buildSavedSummary(
                {
                  ...savedItem,
                  strategy: "chunk",
                  fileName: savedItem.fileName || savedItem.file?.name,
                  fileSize: savedItem.fileSize || savedItem.file?.size,
                  lastModified:
                    savedItem.lastModified || savedItem.file?.lastModified,
                },
                savedItem.completedAt || new Date().toISOString(),
              ),
            ]);
            largeUploadStore.markSaved(id);
          }
        }
      } catch (error) {
        if (singleItem) {
          singleUploadStore.setSaveError(
            id,
            error.message || "Lưu file thất bại",
          );
        }
      } finally {
        savingIdsRef.current.delete(id);
        setSavingIds(new Set(savingIdsRef.current));
      }
    },
    [
      buildSavedSummary,
      largeUploadState.items,
      persistFile,
      singleUploadState.items,
    ],
  );

  const handleSaveAll = useCallback(async () => {
    if (isSavingAllRef.current || savingIdsRef.current.size > 0) return;

    const singleItemsToSave = singleUploadState.items.filter(
      (item) => item.phase === "success" && !item.saved,
    );
    const chunkItemsToSave = largeUploadState.items.filter(
      (item) =>
        (item.phase === "success" && !item.saved) ||
        item.phase === "ready_to_merge" ||
        (item.phase === "merge_failed" &&
          item.uploadedChunkIndexes.length === item.chunks.length &&
          !item.mergeStarted),
    );
    const totalToSave = singleItemsToSave.length + chunkItemsToSave.length;
    if (totalToSave === 0) return;

    isSavingAllRef.current = true;
    setIsSavingAll(true);

    const savedSingleIds = [];
    const successfulSummaries = [];
    const failedNames = [];
    try {
      for (const item of singleItemsToSave) {
        try {
          await persistFile(item);
          savedSingleIds.push(item.id);
          successfulSummaries.push(buildSavedSummary(item));
        } catch (error) {
          failedNames.push(
            item.fileName || item.file?.name || "File không tên",
          );
          singleUploadStore.setSaveError(
            item.id,
            error.message || "Lưu file thất bại",
          );
        }
      }

      for (const item of chunkItemsToSave) {
        if (item.phase === "success") {
          successfulSummaries.push(
            buildSavedSummary(
              {
                ...item,
                strategy: "chunk",
                fileName: item.fileName || item.file?.name,
                fileSize: item.fileSize || item.file?.size,
                lastModified: item.lastModified || item.file?.lastModified,
              },
              item.completedAt || new Date().toISOString(),
            ),
          );
          largeUploadStore.markSaved(item.id);
          continue;
        }

        const savedItem = await largeUploadStore.merge(item.id);
        if (savedItem?.phase === "success") {
          successfulSummaries.push(
            buildSavedSummary(
              {
                ...savedItem,
                strategy: "chunk",
                fileName: savedItem.fileName || savedItem.file?.name,
                fileSize: savedItem.fileSize || savedItem.file?.size,
                lastModified:
                  savedItem.lastModified || savedItem.file?.lastModified,
              },
              savedItem.completedAt || new Date().toISOString(),
            ),
          );
          largeUploadStore.markSaved(item.id);
        } else {
          failedNames.push(
            item.fileName || item.file?.name || "File không tên",
          );
        }
      }

      if (successfulSummaries.length > 0) {
        setSavedFilesSummary(successfulSummaries);
        savedSingleIds.forEach((id) => singleUploadStore.markSaved(id));
      }

      if (failedNames.length > 0) {
        setUploadNotice(
          `Không thể lưu ${failedNames.length} file: ${failedNames.join(", ")}`,
        );
        window.setTimeout(() => setUploadNotice(null), 4000);
      }
    } finally {
      isSavingAllRef.current = false;
      setIsSavingAll(false);
    }
  }, [
    buildSavedSummary,
    largeUploadState.items,
    persistFile,
    singleUploadState.items,
  ]);

  const activeCount = queue.filter((item) =>
    ["idle", "uploading", "finalizing", "paused"].includes(item.phase),
  ).length;
  const completedCount = queue.filter(
    (item) => item.phase === "success" && !item.saved,
  ).length;
  const readyChunkedSaveCount = largeUploadState.items.filter(
    (item) =>
      (item.phase === "success" && !item.saved) ||
      item.phase === "ready_to_merge" ||
      (item.phase === "merge_failed" &&
        item.uploadedChunkIndexes.length === item.chunks.length &&
        !item.mergeStarted),
  ).length;
  const saveableCount = completedCount + readyChunkedSaveCount;
  const canAddMore =
    activeCount < MAX_SINGLE_FILES ||
    largeUploadState.items.filter((item) =>
      ["idle", "uploading", "paused", "ready_to_merge", "merging"].includes(
        item.phase,
      ),
    ).length < MAX_CHUNKED_FILES;
  const largeQueueItems = largeUploadState.items.map((item) => ({
    id: item.id,
    file: item.file,
    phase: item.phase,
    progress: item.progress,
    strategy: "chunk",
    chunkInfo: {
      current: item.uploadedChunks,
      total: item.chunks.length,
    },
    error: item.error,
    saved: Boolean(item.saved),
    completedAt: item.completedAt,
    uploadResponse: null,
    abortController: null,
    speedBps: item.speedBps,
    uploadSessionId: item.uploadSessionId,
    uploadedChunkIndexes: item.uploadedChunkIndexes,
    chunks: item.chunks,
    mergeStarted: item.mergeStarted,
    mergeResponse: item.mergeResponse,
    fileName: item.fileName,
    fileSize: item.fileSize,
    lastModified: item.lastModified,
    hasFile: item.hasFile,
    saveRequested: item.saveRequested,
  }));
  const displayQueue = [...queue, ...largeQueueItems];

  return (
    <>
      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "24px",
          paddingTop: "40px",
        }}
      >
        <div style={{ width: "700px", maxWidth: "100%" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "16px" }}>
            <h1
              style={{
                fontSize: "20px",
                fontWeight: "800",
                color: "#fff",
                marginBottom: "8px",
              }}
            >
              Tải lên file cuộc họp
            </h1>
            <p
              style={{
                fontSize: "12px",
                color: "#8d96aa",
                maxWidth: "460px",
                margin: "0 auto",
                lineHeight: "1.6",
              }}
            >
              Tải lên một hoặc nhiều file ghi âm/ghi hình đã có sẵn để hệ thống
              phân tích và tạo bản ghi. Tối đa {MAX_SINGLE_FILES} file thường và{" "}
              {MAX_CHUNKED_FILES} file lớn.
            </p>
          </div>

          {/* Thông báo đã lưu */}
          {savedNotification && (
            <div
              style={{
                padding: "12px 16px",
                background: "rgba(34, 197, 94, 0.1)",
                color: "#22c55e",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "13px",
                border: "1px solid rgba(34, 197, 94, 0.25)",
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#22c55e"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <span style={{ fontWeight: "600" }}>{savedNotification}</span>
            </div>
          )}

          {uploadNotice && (
            <div
              style={{
                padding: "12px 16px",
                background: "rgba(62, 137, 255, 0.1)",
                color: "#8db7ff",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "13px",
                border: "1px solid rgba(62, 137, 255, 0.25)",
              }}
            >
              {typeof uploadNotice === "string" ? (
                uploadNotice
              ) : (
                <>
                  <div style={{ fontWeight: "600" }}>{uploadNotice.title}</div>
                  {uploadNotice.names.length > 0 && (
                    <ul style={{ margin: "8px 0 0", paddingLeft: "18px" }}>
                      {uploadNotice.names.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {/* Dropzone */}
          {canAddMore && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: isDragging
                  ? "2px dashed #3e89ff"
                  : "2px dashed rgba(255, 255, 255, 0.1)",
                borderRadius: "16px",
                padding: "30px 24px",
                textAlign: "center",
                background: isDragging
                  ? "rgba(62, 137, 255, 0.05)"
                  : "rgba(255, 255, 255, 0.02)",
                marginBottom: "12px",
                transition: "all 0.2s ease",
                cursor: "pointer",
              }}
              onClick={handleChooseFiles}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  background: "rgba(62, 137, 255, 0.1)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 12px",
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#3e89ff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </div>
              <h3
                style={{
                  fontSize: "15px",
                  color: "#fff",
                  margin: "0 0 8px",
                  fontWeight: "700",
                }}
              >
                Kéo thả file vào đây hoặc nhấn để chọn file
              </h3>
              <p
                style={{
                  fontSize: "13px",
                  color: "#8d96aa",
                  margin: "0 0 20px",
                }}
              >
                Hỗ trợ file thường đến 2GB và file lớn đến 5GB
              </p>
              <input
                type="file"
                accept=".mp4,.mkv,.mp3,.m4a"
                multiple
                style={{ display: "none" }}
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              <button
                className="sr-button sr-button-primary"
                style={{
                  minHeight: "40px",
                  height: "40px",
                  width: "auto",
                  padding: "0 24px",
                  fontSize: "13px",
                  display: "inline-flex",
                  gap: "8px",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleChooseFiles();
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="18" x2="12" y2="12"></line>
                  <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
                Chọn file
              </button>
            </div>
          )}

          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "#8d96aa",
              }}
            >
              <span
                style={{
                  width: "4px",
                  height: "4px",
                  background: "#8d96aa",
                  borderRadius: "50%",
                }}
              ></span>
              Định dạng hỗ trợ: .mp4, .mkv, .mp3, .m4a
            </span>
          </div>

          {saveableCount >= 2 && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: "12px",
              }}
            >
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={
                  isSavingAll || savingIds.size > 0 || saveableCount < 2
                }
                style={{
                  background:
                    saveableCount >= 2 && !isSavingAll
                      ? "linear-gradient(135deg, #22c55e, #16a34a)"
                      : "rgba(255,255,255,0.08)",
                  border: "none",
                  color:
                    saveableCount >= 2 && !isSavingAll ? "#fff" : "#576176",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor:
                    saveableCount >= 2 && !isSavingAll
                      ? "pointer"
                      : "not-allowed",
                }}
              >
                {isSavingAll ? "Đang lưu..." : "Lưu tất cả"}
              </button>
            </div>
          )}

          {/* File Queue */}
          {displayQueue.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                marginBottom: "24px",
              }}
            >
              {displayQueue.map((item) => {
                const isDone = item.phase === "success";
                const isError =
                  item.phase === "error" || item.phase === "upload_failed";
                const isInterruptedSingle =
                  item.strategy === "single" &&
                  isError &&
                  item.error?.includes("gián đoạn");
                const isCanceled = item.phase === "canceled";
                const isPaused = item.phase === "paused";
                const isReadyToMerge = item.phase === "ready_to_merge";
                const isMerging = item.phase === "merging";
                const isNeedsFile = item.phase === "needs_file";
                const isMergeFailed = item.phase === "merge_failed";
                const isSaveRequested = Boolean(item.saveRequested);
                const canRetryMerge =
                  item.strategy === "chunk" &&
                  isMergeFailed &&
                  !item.mergeStarted;
                const isItemUploading = item.phase === "uploading";
                const isFinalizing = item.phase === "finalizing";
                const disableRemove =
                  isItemUploading || isFinalizing || isMerging;
                const progressColor =
                  item.strategy === "chunk" ? "#f59e0b" : "#00d1ff";

                const speedBps = item.speedBps || 0;
                const uploadedBytes = item.file.size * (item.progress / 100);
                const remainingBytes = item.file.size - uploadedBytes;
                const remainingSeconds =
                  speedBps > 0 ? remainingBytes / speedBps : 0;

                const formatTime = (seconds) => {
                  if (!seconds || !isFinite(seconds)) return "00:00";
                  const m = Math.floor(seconds / 60);
                  const s = Math.floor(seconds % 60);
                  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
                };

                let statusText = "";
                let statusColor = "#8d96aa";
                if (item.phase === "idle") {
                  statusText = "Sẵn sàng tải lên";
                  statusColor = "#8d96aa";
                } else if (isItemUploading) {
                  statusText = "Đang tải lên";
                  statusColor = "#3e89ff";
                } else if (isFinalizing) {
                  statusText = "Đang hoàn tất...";
                  statusColor = "#f59e0b";
                } else if (isPaused) {
                  statusText = "Tạm dừng";
                  statusColor = "#f59e0b";
                } else if (isNeedsFile) {
                  statusText = "Cần chọn lại file để tiếp tục";
                  statusColor = "#f59e0b";
                } else if (isMerging && isSaveRequested) {
                  statusText = "Đang lưu file...";
                  statusColor = "#f59e0b";
                } else if (isMerging) {
                  statusText = "Đã tải lên, đang chuẩn bị file...";
                  statusColor = "#f59e0b";
                } else if (isReadyToMerge) {
                  statusText = "Sẵn sàng lưu";
                  statusColor = "#22c55e";
                } else if (isDone && !item.saved) {
                  statusText =
                    item.strategy === "chunk"
                      ? "Đã xử lý xong, sẵn sàng lưu"
                      : "Hoàn thành";
                  statusColor = "#22c55e";
                } else if (isDone && item.saved) {
                  statusText = "Đã lưu";
                  statusColor = "#22c55e";
                } else if (isMergeFailed) {
                  statusText = "Lưu thất bại";
                  statusColor = "#020202";
                } else if (isError || isCanceled) {
                  statusText = isCanceled
                    ? "Đã huỷ"
                    : isInterruptedSingle
                      ? "Upload bị gián đoạn"
                      : "Lỗi";
                  statusColor = "#ff5c5c";
                }

                return (
                  <div
                    key={item.id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.05)",
                      borderRadius: "12px",
                      padding: "16px",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    {/* File info header */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "12px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            flexShrink: 0,
                            background: "rgba(62,137,255,0.1)",
                            borderRadius: "8px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#3e89ff"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                          </svg>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: "14px",
                              fontWeight: "700",
                              color: isCanceled || isError ? "#ff5c5c" : "#fff",
                              marginBottom: "4px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.file.name}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: statusColor,
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              flexWrap: "wrap",
                            }}
                          >
                            <span>{formatBytes(item.file.size)}</span>
                            <span style={{ color: "#576176" }}>-</span>
                            <span>{statusText}</span>
                            {item.strategy && (
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: "700",
                                  letterSpacing: "0.5px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background:
                                    item.strategy === "chunk"
                                      ? "rgba(245, 158, 11, 0.15)"
                                      : "rgba(0, 209, 255, 0.15)",
                                  color:
                                    item.strategy === "chunk"
                                      ? "#f59e0b"
                                      : "#00d1ff",
                                  border: `1px solid ${item.strategy === "chunk" ? "rgba(245, 158, 11, 0.3)" : "rgba(0, 209, 255, 0.3)"}`,
                                }}
                              >
                                {item.strategy === "chunk"
                                  ? "File lớn"
                                  : "File thường"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!disableRemove) removeItemFromUI(item);
                        }}
                        disabled={disableRemove}
                        title={
                          disableRemove
                            ? "Không thể ẩn khi file đang xử lý"
                            : "Ẩn khỏi danh sách"
                        }
                        style={{
                          background: "transparent",
                          border: "none",
                          color: disableRemove ? "#30384a" : "#576176",
                          cursor: disableRemove ? "not-allowed" : "pointer",
                          opacity: disableRemove ? 0.45 : 1,
                          padding: "4px",
                          flexShrink: 0,
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>

                    {/* Progress bar + Save button */}
                    {(isError || isCanceled) && !isMergeFailed ? (
                      <>
                        <div
                          style={{
                            width: "100%",
                            height: "4px",
                            background: "rgba(255,62,62,0.2)",
                            borderRadius: "99px",
                            overflow: "hidden",
                            marginBottom: "8px",
                          }}
                        >
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              background: "#ff5c5c",
                            }}
                          ></div>
                        </div>
                        <div style={{ fontSize: "11px", color: "#ff5c5c" }}>
                          <span>{item.error || "Xử lý tải lên thất bại"}</span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            marginTop: "10px",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handleRetryFile(item)}
                            style={{
                              background: "rgba(62, 137, 255, 0.15)",
                              border: "1px solid rgba(62, 137, 255, 0.3)",
                              color: "#3e89ff",
                              padding: "6px 14px",
                              borderRadius: "6px",
                              fontSize: "12px",
                              fontWeight: "700",
                              cursor: "pointer",
                            }}
                          >
                            Thử lại
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                          }}
                        >
                          <div
                            style={{
                              flex: 1,
                              height: "4px",
                              background: "rgba(255,255,255,0.05)",
                              borderRadius: "99px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${item.progress}%`,
                                height: "100%",
                                background:
                                  isDone || isReadyToMerge
                                    ? "#22c55e"
                                    : progressColor,
                                transition: "width 0.15s linear",
                              }}
                            ></div>
                          </div>
                          {/* Nút Lưu */}
                          {((item.strategy === "chunk" &&
                            (isReadyToMerge ||
                              isMerging ||
                              canRetryMerge ||
                              (isDone && !item.saved))) ||
                            (item.strategy !== "chunk" &&
                              isDone &&
                              !item.saved)) && (
                            <button
                              type="button"
                              onClick={() => handleSaveFile(item.id)}
                              disabled={
                                isSavingAll ||
                                savingIds.has(item.id) ||
                                (isMerging && isSaveRequested)
                              }
                              style={{
                                background:
                                  isSavingAll ||
                                  savingIds.has(item.id) ||
                                  (isMerging && isSaveRequested)
                                    ? "rgba(255,255,255,0.08)"
                                    : "linear-gradient(135deg, #22c55e, #16a34a)",
                                border: "none",
                                color:
                                  isSavingAll ||
                                  savingIds.has(item.id) ||
                                  (isMerging && isSaveRequested)
                                    ? "#576176"
                                    : "#fff",
                                padding: "6px 16px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                cursor:
                                  isSavingAll ||
                                  savingIds.has(item.id) ||
                                  (isMerging && isSaveRequested)
                                    ? "not-allowed"
                                    : "pointer",
                                flexShrink: 0,
                              }}
                            >
                              {isMerging && isSaveRequested
                                ? "Đang lưu file..."
                                : savingIds.has(item.id)
                                  ? "Đang lưu..."
                                  : canRetryMerge
                                    ? "Thử lại"
                                    : "Lưu"}
                            </button>
                          )}
                          {item.strategy === "single" && isItemUploading && (
                            <div
                              style={{
                                display: "flex",
                                gap: "6px",
                                flexShrink: 0,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleCancelFile(item.id, item.strategy)
                                }
                                style={{
                                  background: "rgba(255, 92, 92, 0.15)",
                                  border: "1px solid rgba(255, 92, 92, 0.3)",
                                  color: "#ff5c5c",
                                  padding: "6px 12px",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: "700",
                                  cursor: "pointer",
                                }}
                              >
                                Huỷ bỏ
                              </button>
                            </div>
                          )}
                          {item.strategy === "chunk" &&
                            (isItemUploading || isPaused) && (
                              <div
                                style={{
                                  display: "flex",
                                  gap: "6px",
                                  flexShrink: 0,
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    isPaused
                                      ? handleRetryFile(item)
                                      : handlePauseFile(item.id, item.strategy)
                                  }
                                  style={{
                                    background: isPaused
                                      ? "rgba(34, 197, 94, 0.15)"
                                      : "rgba(245, 158, 11, 0.15)",
                                    border: isPaused
                                      ? "1px solid rgba(34, 197, 94, 0.3)"
                                      : "1px solid rgba(245, 158, 11, 0.3)",
                                    color: isPaused ? "#22c55e" : "#f59e0b",
                                    padding: "6px 12px",
                                    borderRadius: "6px",
                                    fontSize: "12px",
                                    fontWeight: "700",
                                    cursor: "pointer",
                                  }}
                                >
                                  {isPaused ? "Tiếp tục" : "Tạm dừng"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCancelFile(item.id, item.strategy)
                                  }
                                  style={{
                                    background: "rgba(255, 92, 92, 0.15)",
                                    border: "1px solid rgba(255, 92, 92, 0.3)",
                                    color: "#ff5c5c",
                                    padding: "6px 12px",
                                    borderRadius: "6px",
                                    fontSize: "12px",
                                    fontWeight: "700",
                                    cursor: "pointer",
                                  }}
                                >
                                  Huỷ bỏ
                                </button>
                              </div>
                            )}
                        </div>
                        {item.saveError && (
                          <div style={{ color: "#ff5c5c", marginTop: "8px" }}>
                            {item.saveError}
                          </div>
                        )}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "11px",
                            color: "#576176",
                            marginTop: "8px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "2px",
                            }}
                          >
                            <span>
                              {item.progress}% hoàn thành
                              {item.chunkInfo && (
                                <span
                                  style={{
                                    marginLeft: "8px",
                                    color: "#f59e0b",
                                  }}
                                >
                                  (
                                  {item.chunkInfo.current < item.chunkInfo.total
                                    ? "Đang tải lên"
                                    : "Hoàn tất tải lên"}{" "}
                                  {item.chunkInfo.current}/
                                  {item.chunkInfo.total})
                                </span>
                              )}
                            </span>
                            {isItemUploading && (
                              <span
                                style={{ color: "#8d96aa", fontSize: "10px" }}
                              >
                                Speed:{" "}
                                {speedBps > 0
                                  ? `${formatBytes(speedBps)}/s`
                                  : "0 MB/s"}{" "}
                                • Remaining: ~{formatTime(remainingSeconds)}
                              </span>
                            )}
                          </div>
                          <span>
                            {formatBytes(uploadedBytes)} /{" "}
                            {formatBytes(item.file.size)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Action buttons */}
          <div
            style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}
          >
            <button
              className="sr-button sr-button-secondary"
              style={{
                minHeight: "36px",
                height: "36px",
                width: "auto",
                padding: "0 24px",
                fontSize: "13px",
              }}
              onClick={() => {
                navigate("/");
              }}
            >
              Hủy
            </button>
            <button
              className="sr-button sr-button-primary"
              style={{
                minHeight: "36px",
                height: "36px",
                width: "auto",
                padding: "0 24px",
                fontSize: "13px",
              }}
              onClick={() => {
                navigate("/history");
              }}
            >
              Tiếp tục
            </button>
          </div>
        </div>
      </div>

      {savedFilesSummary.length > 0 && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(3, 7, 18, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            zIndex: 60,
          }}
        >
          <div
            style={{
              width: "520px",
              maxWidth: "100%",
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px",
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
              padding: "18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: "14px",
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    color: "#fff",
                    fontSize: "18px",
                    fontWeight: "800",
                  }}
                >
                  Lưu file thành công
                </h2>
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "#8d96aa",
                    fontSize: "12px",
                  }}
                >
                  {savedFilesSummary.length === 1
                    ? "File đã được lưu vào hệ thống."
                    : `${savedFilesSummary.length} file đã được lưu vào hệ thống.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSavedFilesSummary([])}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#8d96aa",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-label="Đóng thông báo"
              >
                ×
              </button>
            </div>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {savedFilesSummary.map((file, index) => (
                <div
                  key={`${file.id}-${index}`}
                  style={{
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.03)",
                    padding: "12px",
                  }}
                >
                  <div
                    style={{
                      color: "#fff",
                      fontSize: "13px",
                      fontWeight: "700",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginBottom: "8px",
                    }}
                  >
                    {savedFilesSummary.length > 1
                      ? `${index + 1}. ${file.fileName}`
                      : file.fileName}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: "6px",
                      color: "#8d96aa",
                      fontSize: "12px",
                    }}
                  >
                    <span>Kích thước: {formatBytes(file.fileSize)}</span>
                    <span>Thời lượng: {formatDuration(file.duration)}</span>
                    <span>
                      Hoàn tất lúc: {formatCompletedAt(file.completedAt)}
                    </span>
                    <span>Loại: {file.uploadType || "SINGLE"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UploadPage;
