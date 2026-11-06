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
import { getMediaUploadError, MEDIA_UPLOAD_ACCEPT } from "../../utils/mediaUploadPolicy.js";
import { confirmSimpleUpload, discardSimpleUpload } from "../../features/files/useSingleUpload.js";
import {
  buildUploadDuplicateNotice,
  checkFilesForUploadDuplicates,
} from "../../utils/uploadDuplicateNotice";
import { getFolders, createFolder, moveMeetingsToFolder } from "../../services/folderService";

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

const MAX_SINGLE_FILES = 5;
const MAX_CHUNKED_FILES = 3;
const SINGLE_UPLOAD_LIMIT = 2 * 1024 * 1024 * 1024;
const CHUNKED_UPLOAD_LIMIT = 5 * 1024 * 1024 * 1024;

const LANGUAGES = [
  { id: "auto", label: "Auto" },
  { id: "vi", label: "Vietnamese (Tiếng Việt)" },
  { id: "fr", label: "French (Français)" },
  { id: "en", label: "English (English)" },
  { id: "ja", label: "Japanese (日本語)" },
  { id: "ko", label: "Korean (한국어)" },
  { id: "es", label: "Spanish (Español)" },
  { id: "de", label: "Deutsch (German)" },
  { id: "zh", label: "Chinese (中文)" },
];

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
  const queue = singleUploadState.items;

  // State cho giao diện mới (Folder & Summarize Language)
  const [selectedFolder, setSelectedFolder] = useState({ id: null, name: "All Notes" });
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const [folders, setFolders] = useState([]);
  const [folderSearchText, setFolderSearchText] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("English (English)");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);

  const folderDropdownRef = useRef(null);
  const langDropdownRef = useRef(null);

  const handleCreateFolderSubmit = async (e) => {
    e?.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const created = await createFolder(newFolderName.trim());
      if (created) {
        setFolders((prev) => [...prev, created]);
        setSelectedFolder({ id: created.id, name: created.name });
        setNewFolderName("");
        setIsCreatingFolder(false);
        setFolderDropdownOpen(false);
      }
    } catch (err) {
      console.error("Lỗi khi tạo folder:", err);
    }
  };

  useEffect(() => {
    getFolders()
      .then((data) => {
        if (Array.isArray(data)) setFolders(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (folderDropdownRef.current && !folderDropdownRef.current.contains(e.target)) {
        setFolderDropdownOpen(false);
      }
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target)) {
        setLanguageDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
      const rejectedFiles = [];
      for (const file of fileArray) {
        const formatError = getMediaUploadError(file);
        if (formatError) {
          rejectedFiles.push(`${file.name}: ${formatError}`);
          continue;
        }
        if (file.size > CHUNKED_UPLOAD_LIMIT) {
          rejectedFiles.push(`${file.name}: vượt quá giới hạn 5GB.`);
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
        rejectedFiles.length > 0 ||
        skippedSelectionDuplicates.length > 0 ||
        skippedQueueDuplicates.length > 0
      ) {
        const messageParts = [];
        if (rejectedFiles.length > 0) {
          messageParts.push(`Đã bỏ qua: ${rejectedFiles.join("; ")}`);
        }
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
        await saveFileHandle(recoveryKey, handle).catch(() => { });
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

  const removeItemFromUI = useCallback(async (item) => {
    if (item.strategy === "chunk") {
      largeUploadStore.selectItem(item.id);
      largeUploadStore.cancel();
      largeUploadStore.remove(item.id);
      return;
    }
    if (item.phase === "success" && item.uploadResponse?.objectKey) {
      try {
        await discardSimpleUpload(item.uploadResponse.objectKey);
      } catch {
        setUploadNotice("Tệp đã được gỡ khỏi danh sách chờ nhưng chưa thể dọn khỏi vùng tạm.");
      }
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

  const handleCancelAllUploads = useCallback(async () => {
    for (const item of singleUploadStore.getSnapshot().items) {
      if (item.phase !== "success") singleUploadStore.cancel(item.id);
      await removeItemFromUI(item);
    }
    for (const item of largeUploadStore.getSnapshot().items) {
      largeUploadStore.selectItem(item.id);
      largeUploadStore.cancel();
      largeUploadStore.remove(item.id);
    }
    navigate("/");
  }, [navigate, removeItemFromUI]);

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
            await largeUploadStore.refreshStatus(item.id).catch(() => { });
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
          await largeUploadStore.refreshStatus(item.id).catch(() => { });
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

  const persistFile = useCallback(async (item) => {
    if (item.phase !== "success") {
      throw new Error("File chưa tải lên thành công");
    }
    if (!item.uploadResponse?.objectKey) {
      throw new Error("Không tìm thấy tệp tạm để xác nhận lưu. Vui lòng tải lại tệp.");
    }
    return confirmSimpleUpload(item.uploadResponse);
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
          const confirmedUpload = await persistFile(singleItem);
          const summary = buildSavedSummary({ ...singleItem, uploadResponse: confirmedUpload });
          setSavedFilesSummary([summary]);
          singleUploadStore.markSaved(id);
          if (selectedFolder?.id && confirmedUpload?.meetingId) {
            moveMeetingsToFolder([confirmedUpload.meetingId], selectedFolder.id).catch(() => {});
          }
        } else {
          if (chunkItem.phase === "success") {
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
          const confirmedUpload = await persistFile(item);
          savedSingleIds.push(item.id);
          successfulSummaries.push(buildSavedSummary({ ...item, uploadResponse: confirmedUpload }));
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
          const savedItem = await largeUploadStore.merge(item.id);
          if (savedItem?.phase === "success") {
            successfulSummaries.push(
              buildSavedSummary(
                {
                  ...savedItem,
                  strategy: "chunk",
                  fileName: savedItem.fileName || savedItem.file?.name,
                  fileSize: savedItem.fileSize || savedItem.file?.size,
                  lastModified: savedItem.lastModified || savedItem.file?.lastModified,
                },
                savedItem.completedAt || new Date().toISOString(),
              ),
            );
            largeUploadStore.markSaved(item.id);
          } else {
            failedNames.push(item.fileName || item.file?.name || "File không tên");
          }
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
        if (selectedFolder?.id) {
          const meetingIds = successfulSummaries
            .map((s) => s.meetingId)
            .filter(Boolean);
          if (meetingIds.length > 0) {
            moveMeetingsToFolder(meetingIds, selectedFolder.id).catch(() => {});
          }
        }
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

  const hasFiles = displayQueue.length > 0;
  const hasUploadedSuccess = displayQueue.some(
    (item) => item.phase === "success" || item.saved
  );
  const isItemUploading = displayQueue.some((item) =>
    ["uploading", "finalizing", "merging"].includes(item.phase)
  );

  const canSubmitAiSummary = hasFiles && !isSavingAll && savingIds.size === 0;

  const handleAiSummarySubmit = async () => {
    if (!hasFiles) {
      handleChooseFiles();
      return;
    }
    if (isSavingAll || savingIds.size > 0) return;
    if (saveableCount > 0) {
      await handleSaveAll();
      return;
    }
    if (hasUploadedSuccess) {
      navigate("/history");
      return;
    }
    if (isItemUploading) {
      setUploadNotice("Hệ thống đang tải lên các file. Khi hoàn tất, các cuộc họp sẽ tự động được lưu và tạo bản tóm tắt AI.");
      window.setTimeout(() => setUploadNotice(null), 4000);
      return;
    }
  };

  return (
    <>
      <div className="w-full flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
        <div className="relative w-full max-w-[720px] bg-[#0d1424] text-[#f7f9ff] rounded-[28px] shadow-2xl shadow-black/70 p-6 sm:p-8 border border-[#1e2a44] font-sans transition-all">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-[#f7f9ff] tracking-tight">
                Upload files
              </h1>
              <p className="text-xs sm:text-sm text-[#8d96aa] mt-1">
                Upload one or more files and let AI summarize them into clear insights
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#8d96aa] hover:text-[#f7f9ff] hover:bg-white/10 transition-colors cursor-pointer"
              title="Đóng"
            >
              <svg
                width="20"
                height="20"
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

          {/* Thông báo đã lưu */}
          {savedNotification && (
            <div className="mb-4 p-3 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs rounded-xl flex items-center gap-2.5">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <span className="font-semibold">{savedNotification}</span>
            </div>
          )}

          {uploadNotice && (
            <div className="mb-4 p-3 bg-blue-950/40 border border-blue-500/40 text-blue-300 text-xs rounded-xl">
              {typeof uploadNotice === "string" ? (
                uploadNotice
              ) : (
                <>
                  <div className="font-bold">{uploadNotice.title}</div>
                  {uploadNotice.names?.length > 0 && (
                    <ul className="mt-1.5 list-disc pl-5 space-y-0.5">
                      {uploadNotice.names.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {/* Dropzone Area */}
          {canAddMore && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleChooseFiles}
              className={`relative w-full rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center cursor-pointer transition-all duration-200 mb-4 select-none ${
                isDragging
                  ? "border-blue-500 bg-blue-950/30"
                  : "border-[#24324f] hover:border-blue-500/70 bg-[#090f1d] hover:bg-[#0c1326]"
              }`}
            >
              <input
                type="file"
                accept={MEDIA_UPLOAD_ACCEPT}
                multiple
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-2xl bg-[#141e33] border border-[#223352] flex items-center justify-center mx-auto mb-3 text-blue-400 shadow-inner">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="18" x2="12" y2="12"></line>
                  <polyline points="9 15 12 12 15 15"></polyline>
                </svg>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-[#f7f9ff] mb-1">
                Click to upload file(s) or drag and drop
              </h3>
              <p className="text-[11px] sm:text-xs text-[#8d96aa] flex items-center justify-center gap-1.5 flex-wrap">
                <span>Maximum document size: 20 MB per file · Audio length: Up to 5 hours · Common types supported</span>
                <span className="relative group/tooltip inline-flex items-center cursor-help">
                  <svg className="w-3.5 h-3.5 text-[#8d96aa] hover:text-[#f7f9ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tooltip:block bg-[#162035] text-slate-200 border border-[#263756] text-[10px] py-1 px-2.5 rounded-lg shadow-2xl whitespace-nowrap z-50">
                    Định dạng: MP4, MKV, MP3, M4A (Tối đa 2GB thường, 5GB file lớn)
                  </span>
                </span>
              </p>
            </div>
          )}

          {/* Form Field 1: Folder */}
          <div className="mb-3.5 relative" ref={folderDropdownRef}>
            <label className="text-xs font-semibold text-[#8d96aa] mb-1.5 block">
              Folder
            </label>
            <div
              onClick={() => {
                setFolderDropdownOpen((prev) => !prev);
                setLanguageDropdownOpen(false);
                setIsCreatingFolder(false);
                setFolderSearchText("");
              }}
              className="w-full bg-[#131b2e] hover:bg-[#18233a] rounded-2xl px-4 py-3 flex items-center justify-between cursor-pointer border border-[#1e2a44] hover:border-blue-500/40 transition select-none"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-[#1b253b] border border-[#283854] flex items-center justify-center text-blue-400 shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <span className="text-sm font-semibold text-[#f7f9ff] truncate">
                  {selectedFolder.name}
                </span>
              </div>
              <svg className="w-4 h-4 text-[#8d96aa] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>
              </svg>
            </div>

            {folderDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#0f1728] rounded-2xl border border-[#1e2a44] shadow-2xl z-50 overflow-hidden">
                {/* Search folders... */}
                <div className="p-3 border-b border-[#1e2a44]/80 flex items-center gap-2 bg-[#131b2e]/40">
                  <input
                    type="text"
                    value={folderSearchText}
                    onChange={(e) => setFolderSearchText(e.target.value)}
                    placeholder="Search folders..."
                    className="w-full bg-transparent text-xs text-[#f7f9ff] placeholder-[#64748b] focus:outline-none"
                    autoFocus
                  />
                </div>

                {/* Danh sách folder */}
                <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
                  {/* All Notes */}
                  {(!folderSearchText.trim() ||
                    "all notes".includes(folderSearchText.toLowerCase()) ||
                    "tất cả ghi chú".includes(folderSearchText.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFolder({ id: null, name: "All Notes" });
                        setFolderDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-[#18233a] rounded-xl transition cursor-pointer ${
                        selectedFolder.id === null ? "text-[#f7f9ff] font-semibold bg-[#18233a]/60" : "text-[#c2c8d6]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[#8d96aa] shrink-0">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span className="truncate">All Notes</span>
                      </div>
                      {selectedFolder.id === null && (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#f7f9ff] shrink-0 ml-auto">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      )}
                    </button>
                  )}

                  {/* Folders của user (thụt lề như trong ảnh mẫu) */}
                  {folders
                    .filter((f) =>
                      f.name.toLowerCase().includes(folderSearchText.toLowerCase())
                    )
                    .map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setSelectedFolder({ id: f.id, name: f.name });
                          setFolderDropdownOpen(false);
                        }}
                        className={`w-full pl-8 pr-3 py-2 text-left text-xs flex items-center justify-between hover:bg-[#18233a] rounded-xl transition cursor-pointer ${
                          selectedFolder.id === f.id ? "text-[#f7f9ff] font-semibold bg-[#18233a]/60" : "text-[#c2c8d6]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[#8d96aa] shrink-0">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                          </svg>
                          <span className="truncate">{f.name}</span>
                        </div>
                        {selectedFolder.id === f.id && (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#f7f9ff] shrink-0 ml-auto">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </button>
                    ))}
                </div>

                {/* Footer: Create new folder */}
                <div className="p-2 border-t border-[#1e2a44]/80 bg-[#131b2e]/20">
                  {!isCreatingFolder ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsCreatingFolder(true);
                      }}
                      className="w-full px-2.5 py-2 text-left text-xs font-medium text-[#c2c8d6] hover:text-[#f7f9ff] hover:bg-[#18233a] rounded-xl flex items-center gap-2.5 transition cursor-pointer"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[#8d96aa]">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        <line x1="12" y1="11" x2="12" y2="17"></line>
                        <line x1="9" y1="14" x2="15" y2="14"></line>
                      </svg>
                      <span>Create new folder</span>
                    </button>
                  ) : (
                    <form
                      onSubmit={handleCreateFolderSubmit}
                      className="flex items-center gap-1.5 p-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="New folder name..."
                        className="flex-1 bg-[#162035] text-xs text-white px-2.5 py-1.5 rounded-lg border border-[#2b3d60] focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                      <button
                        type="submit"
                        disabled={!newFolderName.trim()}
                        className="px-2.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-50 transition cursor-pointer"
                      >
                        Create
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingFolder(false);
                          setNewFolderName("");
                        }}
                        className="px-2 py-1.5 text-xs text-[#8d96aa] hover:text-white rounded-lg transition cursor-pointer"
                      >
                        ✕
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Form Field 2: Summarize Language */}
          <div className="mb-5 relative" ref={langDropdownRef}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-xs font-semibold text-[#8d96aa]">
                Summarize Language
              </label>
              <div className="relative group/lang inline-flex items-center cursor-help">
                <svg className="w-3.5 h-3.5 text-[#8d96aa] hover:text-[#f7f9ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/lang:block bg-[#162035] text-slate-200 border border-[#263756] text-[10px] py-1 px-2.5 rounded-lg shadow-2xl whitespace-nowrap z-50">
                  Ngôn ngữ mô hình AI sẽ dùng để xuất bản tóm tắt và trích xuất nhiệm vụ
                </span>
              </div>
            </div>
            <div
              onClick={() => {
                setLanguageDropdownOpen((prev) => !prev);
                setFolderDropdownOpen(false);
              }}
              className="w-full bg-[#131b2e] hover:bg-[#18233a] rounded-2xl px-4 py-3 flex items-center justify-between cursor-pointer border border-[#1e2a44] hover:border-blue-500/40 transition select-none"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-[#1b253b] border border-[#283854] flex items-center justify-center text-blue-400 shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                </div>
                <span className="text-sm font-semibold text-[#f7f9ff] truncate">
                  {selectedLanguage}
                </span>
              </div>
              <svg className="w-4 h-4 text-[#8d96aa] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>
              </svg>
            </div>

            {languageDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#0f1728] rounded-2xl border border-[#1e2a44] shadow-2xl py-2 z-50 max-h-60 overflow-y-auto">
                <div className="px-3.5 pt-1 pb-1 text-[11px] font-semibold text-[#8d96aa] tracking-wide select-none">
                  All
                </div>
                <div className="p-1 space-y-0.5">
                  {LANGUAGES.map((lang) => {
                    const isSelected = selectedLanguage === lang.label;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        onClick={() => {
                          setSelectedLanguage(lang.label);
                          setLanguageDropdownOpen(false);
                        }}
                        className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between rounded-xl transition cursor-pointer ${
                          isSelected
                            ? "text-[#f7f9ff] bg-[#1a253c] font-semibold"
                            : "text-[#c2c8d6] hover:bg-[#18233a] hover:text-[#f7f9ff]"
                        }`}
                      >
                        <span className="truncate">{lang.label}</span>
                        {isSelected && (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#f7f9ff] shrink-0 ml-auto">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* File Queue */}
          {displayQueue.length > 0 && (
            <div className="flex flex-col gap-3 mb-5 max-h-60 overflow-y-auto pr-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-[#c2c8d6]">
                  Danh sách file ({displayQueue.length})
                </span>
                {saveableCount >= 2 && (
                  <button
                    type="button"
                    onClick={handleSaveAll}
                    disabled={isSavingAll || savingIds.size > 0}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/15 px-2.5 py-1 rounded-lg border border-emerald-500/30 transition cursor-pointer"
                  >
                    {isSavingAll ? "Đang lưu..." : "Lưu tất cả"}
                  </button>
                )}
              </div>

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
                let statusColor = "text-[#8d96aa]";
                if (item.phase === "idle") {
                  statusText = "Sẵn sàng tải lên";
                  statusColor = "text-[#8d96aa]";
                } else if (isItemUploading) {
                  statusText = "Đang tải lên";
                  statusColor = "text-blue-400";
                } else if (isFinalizing) {
                  statusText = "Đang hoàn tất...";
                  statusColor = "text-amber-400";
                } else if (isPaused) {
                  statusText = "Tạm dừng";
                  statusColor = "text-amber-400";
                } else if (isNeedsFile) {
                  statusText = "Cần chọn lại file";
                  statusColor = "text-amber-400";
                } else if (isMerging && isSaveRequested) {
                  statusText = "Đang lưu file...";
                  statusColor = "text-amber-400";
                } else if (isMerging) {
                  statusText = "Đang chuẩn bị file...";
                  statusColor = "text-amber-400";
                } else if (isReadyToMerge) {
                  statusText = "Sẵn sàng lưu";
                  statusColor = "text-emerald-400";
                } else if (isDone && !item.saved) {
                  statusText =
                    item.strategy === "chunk"
                      ? "Đã xử lý xong, sẵn sàng lưu"
                      : "Hoàn thành";
                  statusColor = "text-emerald-400";
                } else if (isDone && item.saved) {
                  statusText = "Đã lưu";
                  statusColor = "text-emerald-400";
                } else if (isMergeFailed) {
                  statusText = "Lưu thất bại";
                  statusColor = "text-red-400";
                } else if (isError || isCanceled) {
                  statusText = isCanceled
                    ? "Đã huỷ"
                    : isInterruptedSingle
                      ? "Upload bị gián đoạn"
                      : "Lỗi";
                  statusColor = "text-red-400";
                }

                return (
                  <div
                    key={item.id}
                    className="border border-[#1e2a44] rounded-2xl p-3.5 bg-[#131b2e] transition-all text-xs"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/25 text-blue-400 flex items-center justify-center shrink-0">
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
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <div
                            className={`font-bold truncate ${
                              isCanceled || isError ? "text-red-400" : "text-[#f7f9ff]"
                            }`}
                          >
                            {item.file.name}
                          </div>
                          <div className="text-[11px] text-[#8d96aa] flex items-center gap-1.5 mt-0.5">
                            <span>{formatBytes(item.file.size)}</span>
                            <span>•</span>
                            <span className={statusColor}>{statusText}</span>
                            {item.strategy && (
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                  item.strategy === "chunk"
                                    ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                                    : "bg-blue-500/15 text-blue-300 border-blue-500/30"
                                }`}
                              >
                                {item.strategy === "chunk" ? "File lớn" : "File thường"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Nút thao tác theo trạng thái */}
                        {isError && (
                          <button
                            type="button"
                            onClick={() => handleRetryFile(item)}
                            className="px-2.5 py-1 text-[11px] font-bold text-blue-300 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 rounded-lg transition cursor-pointer"
                          >
                            Thử lại
                          </button>
                        )}

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
                            className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-sm"
                          >
                            {isMerging && isSaveRequested
                              ? "Đang lưu..."
                              : savingIds.has(item.id)
                                ? "Đang lưu..."
                                : canRetryMerge
                                  ? "Thử lại"
                                  : "Lưu"}
                          </button>
                        )}

                        {item.strategy === "chunk" &&
                          (isItemUploading || isPaused) && (
                            <button
                              type="button"
                              onClick={() =>
                                isPaused
                                    ? handleRetryFile(item)
                                    : handlePauseFile(item.id, item.strategy)
                              }
                              className={`px-2 py-1 text-[11px] font-bold rounded-lg transition border cursor-pointer ${
                                isPaused
                                  ? "text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/30"
                                  : "text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/30"
                              }`}
                            >
                              {isPaused ? "Tiếp tục" : "Tạm dừng"}
                            </button>
                          )}

                        {!disableRemove && (
                          <button
                            type="button"
                            onClick={() => removeItemFromUI(item)}
                            className="text-[#8d96aa] hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition cursor-pointer"
                            title="Xóa khỏi danh sách"
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
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1.5 bg-[#0a0f1d] border border-[#1b253b] rounded-full overflow-hidden mt-1.5">
                      <div
                        className={`h-full transition-all duration-150 ${
                          isDone || isReadyToMerge
                            ? "bg-emerald-500"
                            : isError
                              ? "bg-red-500"
                              : "bg-blue-500"
                        }`}
                        style={{ width: `${item.progress}%` }}
                      ></div>
                    </div>

                    {/* Meta progress */}
                    <div className="flex items-center justify-between text-[10px] text-[#8d96aa] mt-1">
                      <span>{item.progress}% hoàn thành</span>
                      {isItemUploading && (
                        <span>
                          {speedBps > 0
                            ? `${formatBytes(speedBps)}/s`
                            : "0 MB/s"}{" "}
                          • Còn ~{formatTime(remainingSeconds)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Centered Continue Button */}
          <div className="flex justify-center mt-6">
            <button
              type="button"
              disabled={!canSubmitAiSummary}
              onClick={handleAiSummarySubmit}
              className={`px-12 py-3 rounded-full font-bold text-sm tracking-wide transition-all shadow-sm ${
                canSubmitAiSummary
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 active:scale-95 cursor-pointer"
                  : "bg-[#131b2e] text-[#556580] cursor-not-allowed border border-[#1e2a44]"
              }`}
            >
              {isSavingAll
                ? "Đang lưu file..."
                : isItemUploading
                  ? "Đang tải lên..."
                  : "Tiếp tục"}
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
              maxHeight: "min(680px, calc(100vh - 48px))",
              display: "flex",
              flexDirection: "column",
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
                flexShrink: 0,
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
                  flexShrink: 0,
                }}
                aria-label="Đóng thông báo"
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                overflowY: "auto",
                flex: 1,
                minHeight: 0,
                paddingRight: "4px",
              }}
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
