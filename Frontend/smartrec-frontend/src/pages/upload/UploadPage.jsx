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
import { getFolders, moveMeetingsToFolder } from "../../services/folderService.js";
import {
  getMeetings,
  startMeetingProcessing,
} from "../../services/meetingService.js";
import {
  CheckIcon,
  ChevronDownIcon,
  PencilIcon,
  TrashIcon,
  XIcon,
} from "../../components/common/icons.jsx";
import {
  getUploadFileNameDraft,
  normalizeUploadFileName,
} from "../../utils/uploadFileName.js";
import { getUploadActionButtonState } from "../../utils/uploadActionState.js";
import "./UploadPage.css";
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

const MAX_SINGLE_FILES = 5;
const MAX_CHUNKED_FILES = 3;
const SINGLE_UPLOAD_LIMIT = 2 * 1024 * 1024 * 1024;
const CHUNKED_UPLOAD_LIMIT = 5 * 1024 * 1024 * 1024;

const getFileIdentity = (file) =>
  `${file.name}-${file.size}-${file.lastModified}`;

const getFolderPath = (folder, folderList) => {
  const foldersById = new Map(folderList.map((item) => [item.id, item]));
  const path = [];
  const visited = new Set();
  let current = folder;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.push(current.name);
    current = current.parentId ? foldersById.get(current.parentId) : null;
  }
  return path.reverse().join(" / ");
};

const buildQueueIdentitySet = (singleItems, chunkedItems) =>
  new Set([
    ...singleItems
      .filter((item) => item.hasFile !== false)
      .map(
        (item) =>
          `${item.sourceFileName || item.fileName || item.file?.name}-${item.fileSize || item.file?.size}-${item.file?.lastModified || item.lastModified || ""}`,
      ),
    ...chunkedItems
      .filter((item) => item.hasFile !== false)
      .map(
        (item) =>
          `${item.sourceFileName || item.fileName || item.file?.name}-${item.fileSize || item.file?.size}-${item.file?.lastModified || item.lastModified || ""}`,
      ),
  ]);

const mergeSavedSummaries = (current, incoming) => {
  const incomingKeys = new Set(
    incoming.map((item) => item.meetingId || item.id),
  );
  return [
    ...current.filter((item) => !incomingKeys.has(item.meetingId || item.id)),
    ...incoming,
  ];
};

const UploadPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const pendingRecoveryItemIdRef = useRef(null);
  const singleUploadState = useSingleUploadStore();
  const largeUploadState = useLargeUploadStore();

  const [meetingName, setMeetingName] = useState("");
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [folderLoadError, setFolderLoadError] = useState(false);
  const [renameDraftById, setRenameDraftById] = useState({});
  const [editingFileId, setEditingFileId] = useState(null);
  const [editingBaseName, setEditingBaseName] = useState("");
  const [isStartingUploads, setIsStartingUploads] = useState(false);
  const [isStartingProcessing, setIsStartingProcessing] = useState(false);
  const [processingError, setProcessingError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadNotice, setUploadNotice] = useState(null);
  const [savedFilesSummary, setSavedFilesSummary] = useState([]);
  const [durationByFileId, setDurationByFileId] = useState({});
  const [savingIds, setSavingIds] = useState(() => new Set());
  const [isSavingAll, setIsSavingAll] = useState(false);
  const savingIdsRef = useRef(new Set());
  const isSavingAllRef = useRef(false);
  const startUploadsRef = useRef(false);
  const startProcessingRef = useRef(false);
  const renameInputRef = useRef(null);
  const pendingChunkStartIdsRef = useRef([]);
  const startingChunkRef = useRef(false);
  const queue = singleUploadState.items;

  useEffect(() => {
    if (!editingFileId || !renameInputRef.current) return;
    renameInputRef.current.focus();
    renameInputRef.current.select();
  }, [editingFileId]);

  useEffect(() => {
    let isActive = true;
    getFolders("all")
      .then((folderList) => {
        if (isActive) setFolders(Array.isArray(folderList) ? folderList : []);
      })
      .catch(() => {
        if (isActive) setFolderLoadError(true);
      });
    return () => {
      isActive = false;
    };
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
          false,
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
        if (import.meta.env.DEV) {
          console.log("[upload-page:chunked-awaiting-confirmation]", {
            startId: chunkedIds[0] || null,
          });
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
          selectedFile.name === (item.sourceFileName || item.fileName) &&
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

  const persistFile = useCallback(async (item) => {
    if (item.phase !== "success") {
      throw new Error("File chưa tải lên thành công");
    }
    if (!item.uploadResponse?.objectKey) {
      throw new Error("Không tìm thấy tệp tạm để xác nhận lưu. Vui lòng tải lại tệp.");
    }
    const confirmed = await confirmSimpleUpload(item.uploadResponse);
    if (selectedFolderId) {
      if (!confirmed?.meetingId) {
        throw new Error("Không tìm thấy cuộc họp vừa lưu để chuyển thư mục.");
      }
      await moveMeetingsToFolder([confirmed.meetingId], selectedFolderId);
    }
    return confirmed;
  }, [selectedFolderId]);

  const findMeetingsForFile = useCallback(async (fileName, fileSize) => {
    const response = await getMeetings({ keyword: fileName, page: 0, size: 100 });
    return response.content.filter(
      (meeting) =>
        meeting.fileName === fileName &&
        Number(meeting.fileSizeBytes) === Number(fileSize),
    );
  }, []);

  const mergeAndPlaceInFolder = useCallback(async (id) => {
    const item = largeUploadStore
      .getSnapshot()
      .items.find((candidate) => candidate.id === id);
    if (!item) return null;

    const existingMeetings = await findMeetingsForFile(
      item.fileName,
      item.fileSize,
    ).catch((error) => {
      if (selectedFolderId) throw error;
      return [];
    });
    const existingIds = new Set(existingMeetings.map((meeting) => meeting.id));
    const savedItem = await largeUploadStore.merge(id);
    if (savedItem?.phase !== "success") return savedItem;

    const matchingMeetings = await findMeetingsForFile(item.fileName, item.fileSize)
      .catch((error) => {
        if (selectedFolderId) throw error;
        return [];
      });
    const newlySaved = matchingMeetings
      .filter((meeting) => !existingIds.has(meeting.id))
      .sort(
        (first, second) =>
          new Date(second.createdAt || 0).getTime() -
          new Date(first.createdAt || 0).getTime(),
      );
    const meeting = newlySaved[0];
    if (!meeting && selectedFolderId) {
      throw new Error("File đã lưu nhưng không tìm thấy bản ghi để chuyển thư mục.");
    }
    if (meeting && selectedFolderId) {
      await moveMeetingsToFolder([meeting.id], selectedFolderId);
    }
    return {
      ...savedItem,
      meetingId: meeting?.id || null,
      meetingStatus: meeting?.status || "UNPROCESSED",
    };
  }, [findMeetingsForFile, selectedFolderId]);

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
      meetingId: item.meetingId || item.uploadResponse?.meetingId || null,
      meetingStatus:
        item.meetingStatus ||
        item.uploadResponse?.meetingStatus ||
        "UNPROCESSED",
      processingStarted: false,
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
          setSavedFilesSummary((current) => mergeSavedSummaries(current, [summary]));
          singleUploadStore.markSaved(id);
        } else {
          if (chunkItem.phase === "success") {
            const savedItem = await mergeAndPlaceInFolder(id);
            if (savedItem?.phase === "success") {
              const summary = buildSavedSummary(
                  {
                    ...savedItem,
                    strategy: "chunk",
                    fileName: savedItem.fileName || savedItem.file?.name,
                    fileSize: savedItem.fileSize || savedItem.file?.size,
                    lastModified:
                      savedItem.lastModified || savedItem.file?.lastModified,
                  },
                  savedItem.completedAt || new Date().toISOString(),
                );
              setSavedFilesSummary((current) => mergeSavedSummaries(current, [summary]));
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
          const savedItem = await mergeAndPlaceInFolder(id);
          if (savedItem?.phase === "success") {
            const summary = buildSavedSummary(
                {
                  ...savedItem,
                  strategy: "chunk",
                  fileName: savedItem.fileName || savedItem.file?.name,
                  fileSize: savedItem.fileSize || savedItem.file?.size,
                  lastModified:
                    savedItem.lastModified || savedItem.file?.lastModified,
                },
                savedItem.completedAt || new Date().toISOString(),
              );
            setSavedFilesSummary((current) => mergeSavedSummaries(current, [summary]));
            largeUploadStore.markSaved(id);
          }
        }
      } catch (error) {
        if (singleItem) {
          singleUploadStore.setSaveError(
            id,
            error.message || "Lưu file thất bại",
          );
        } else {
          setUploadNotice(error.message || "Lưu file thất bại");
        }
      } finally {
        savingIdsRef.current.delete(id);
        setSavingIds(new Set(savingIdsRef.current));
      }
    },
    [
      buildSavedSummary,
      largeUploadState.items,
      mergeAndPlaceInFolder,
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
    const saveErrors = [];
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
          const savedItem = await mergeAndPlaceInFolder(item.id).catch((error) => {
            saveErrors.push(error.message || "Không thể lưu hoặc chuyển thư mục.");
            return null;
          });
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

        const savedItem = await mergeAndPlaceInFolder(item.id).catch((error) => {
          saveErrors.push(error.message || "Không thể lưu hoặc chuyển thư mục.");
          return null;
        });
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
        setSavedFilesSummary((current) =>
          mergeSavedSummaries(current, successfulSummaries),
        );
        savedSingleIds.forEach((id) => singleUploadStore.markSaved(id));
      }

      if (failedNames.length > 0 || saveErrors.length > 0) {
        const noticeParts = [];
        if (failedNames.length > 0) {
          noticeParts.push(
            `Không thể lưu ${failedNames.length} file: ${failedNames.join(", ")}`,
          );
        }
        if (saveErrors.length > 0) noticeParts.push(saveErrors.join(" "));
        setUploadNotice(noticeParts.join(" "));
        window.setTimeout(() => setUploadNotice(null), 4000);
      }
    } finally {
      isSavingAllRef.current = false;
      setIsSavingAll(false);
    }
  }, [
    buildSavedSummary,
    mergeAndPlaceInFolder,
    largeUploadState.items,
    persistFile,
    singleUploadState.items,
  ]);

  const preparedSingleItems = queue.filter(
    (item) => item.phase === "idle" && item.hasFile !== false,
  );
  const preparedChunkItems = largeUploadState.items.filter(
    (item) => item.phase === "idle" && item.hasFile,
  );
  const preparedItems = [...preparedSingleItems, ...preparedChunkItems];
  const preparedCount = preparedSingleItems.length + preparedChunkItems.length;
  const getItemNameDraft = (item) => {
    const defaultDraft = getUploadFileNameDraft(item);
    return {
      ...defaultDraft,
      baseName: Object.prototype.hasOwnProperty.call(renameDraftById, item.id)
        ? renameDraftById[item.id]
        : defaultDraft.baseName,
    };
  };
  const normalizedNamesById = new Map(
    preparedItems.map((item) => {
      const draft = getItemNameDraft(item);
      return [item.id, normalizeUploadFileName(draft.baseName, draft.extension)];
    }),
  );
  const reservedFileNames = [
    ...singleUploadState.items.filter((item) => item.phase !== "idle"),
    ...largeUploadState.items.filter((item) => item.phase !== "idle"),
  ]
    .map((item) => item.fileName || item.sourceFileName || item.file?.name || "")
    .concat(savedFilesSummary.map((item) => item.fileName || ""));
  const normalizedNameCounts = new Map();
  [...normalizedNamesById.values(), ...reservedFileNames].forEach((fileName) => {
    if (!fileName) return;
    const key = fileName.toLocaleLowerCase();
    normalizedNameCounts.set(key, (normalizedNameCounts.get(key) || 0) + 1);
  });
  const renameErrorsById = new Map(
    preparedItems.map((item) => {
      const draft = getItemNameDraft(item);
      const normalizedFileName = normalizedNamesById.get(item.id);
      if (!draft.baseName.trim()) {
        return [item.id, "Nhập tên tệp trước khi tải lên."];
      }
      if (!normalizedFileName) {
        return [item.id, "Tên tệp không hợp lệ."];
      }
      if (
        normalizedNameCounts.get(normalizedFileName.toLocaleLowerCase()) > 1
      ) {
        return [item.id, "Tên tệp bị trùng với một tệp khác."];
      }
      return [item.id, ""];
    }),
  );
  const getRenameValidationError = (item, baseName) => {
    if (!String(baseName ?? "").trim()) {
      return "Nhập tên tệp trước khi tải lên.";
    }
    const draft = getItemNameDraft(item);
    const normalizedFileName = normalizeUploadFileName(
      baseName,
      draft.extension,
    );
    if (!normalizedFileName) return "Tên tệp không hợp lệ.";

    const duplicate = preparedItems.some((otherItem) => {
      if (otherItem.id === item.id) return false;
      const otherDraft = getItemNameDraft(otherItem);
      const otherName = normalizeUploadFileName(
        otherDraft.baseName,
        otherDraft.extension,
      );
      return (
        otherName &&
        otherName.toLocaleLowerCase() === normalizedFileName.toLocaleLowerCase()
      );
    }) || reservedFileNames.some(
      (otherName) =>
        String(otherName).trim().toLocaleLowerCase() ===
        normalizedFileName.toLocaleLowerCase(),
    );
    return duplicate ? "Tên tệp bị trùng với một tệp khác." : "";
  };
  const cancelInlineRename = () => {
    setEditingFileId(null);
    setEditingBaseName("");
  };
  const commitInlineRename = (item) => {
    const error = getRenameValidationError(item, editingBaseName);
    if (error) return;

    const draft = getItemNameDraft(item);
    const normalizedName = normalizeUploadFileName(
      editingBaseName,
      draft.extension,
    );
    const normalizedBaseName = draft.extension
      ? normalizedName.slice(0, -draft.extension.length)
      : normalizedName;
    setRenameDraftById((current) => ({
      ...current,
      [item.id]: normalizedBaseName,
    }));
    cancelInlineRename();
  };
  const arePreparedNamesValid =
    preparedCount >= 1 &&
    editingFileId === null &&
    preparedItems.every((item) => !renameErrorsById.get(item.id));
  const hasUploadInProgress =
    singleUploadState.items.some((item) =>
      ["uploading", "finalizing"].includes(item.phase),
    ) ||
    largeUploadState.items.some((item) =>
      item.phase === "uploading",
    );
  const isChunkSaveInProgress = largeUploadState.items.some(
    (item) => item.phase === "merging",
  );
  const uploadAction = getUploadActionButtonState({
    preparedCount,
    arePreparedNamesValid,
    isStartingUploads,
    hasUploadInProgress,
    pendingChunkCount: pendingChunkStartIdsRef.current.length,
  });
  const processableSavedFiles = savedFilesSummary.filter(
    (file) =>
      file.meetingId &&
      !file.processingStarted &&
      String(file.meetingStatus || "UNPROCESSED").toUpperCase() ===
        "UNPROCESSED",
  );

  const handleStartProcessing = useCallback(async () => {
    if (startProcessingRef.current || processableSavedFiles.length === 0) return;
    startProcessingRef.current = true;
    setIsStartingProcessing(true);
    setProcessingError("");
    try {
      for (const file of processableSavedFiles) {
        await startMeetingProcessing(file.meetingId);
        setSavedFilesSummary((current) =>
          current.map((savedFile) =>
            savedFile.meetingId === file.meetingId
              ? { ...savedFile, processingStarted: true }
              : savedFile,
          ),
        );
      }
      navigate(`/meeting/${processableSavedFiles[0].meetingId}`);
    } catch (error) {
      setProcessingError(
        error?.message || "Không thể bắt đầu xử lý cuộc họp. Vui lòng thử lại.",
      );
    } finally {
      startProcessingRef.current = false;
      setIsStartingProcessing(false);
    }
  }, [navigate, processableSavedFiles]);

  const startNextChunkUpload = useCallback(async () => {
    if (startingChunkRef.current) return;
    const currentState = largeUploadStore.getSnapshot();
    const activeChunk = currentState.items.some((item) =>
      ["uploading", "merging"].includes(item.phase),
    );
    if (activeChunk) return;

    while (pendingChunkStartIdsRef.current.length > 0) {
      const nextId = pendingChunkStartIdsRef.current.shift();
      const nextItem = largeUploadStore
        .getSnapshot()
        .items.find((item) => item.id === nextId);
      if (!nextItem || nextItem.phase !== "idle" || !nextItem.hasFile) continue;

      startingChunkRef.current = true;
      try {
        largeUploadStore.selectItem(nextId);
        await largeUploadStore.start(nextId);
      } finally {
        startingChunkRef.current = false;
        window.setTimeout(() => {
          void startNextChunkUpload();
        }, 0);
      }
      return;
    }
  }, []);

  useEffect(() => {
    if (pendingChunkStartIdsRef.current.length === 0) return;
    if (startingChunkRef.current) return;
    const activeChunk = largeUploadState.items.some((item) =>
      ["uploading", "merging"].includes(item.phase),
    );
    if (!activeChunk) void startNextChunkUpload();
  }, [largeUploadState.items, startNextChunkUpload]);

  const handleStartUploads = useCallback(async () => {
    if (
      startUploadsRef.current ||
      !arePreparedNamesValid ||
      hasUploadInProgress ||
      pendingChunkStartIdsRef.current.length > 0
    ) {
      return;
    }

    startUploadsRef.current = true;
    setIsStartingUploads(true);
    try {
      preparedSingleItems.forEach((item) => {
        const fileName = normalizedNamesById.get(item.id);
        singleUploadStore.renameFile(item.id, fileName);
        void singleUploadStore.start(item.id, meetingName, fileName);
      });

      preparedChunkItems.forEach((item) => {
        const fileName = normalizedNamesById.get(item.id);
        largeUploadStore.renameFile(item.id, fileName);
      });
      pendingChunkStartIdsRef.current = preparedChunkItems.map((item) => item.id);
      await startNextChunkUpload();
    } finally {
      startUploadsRef.current = false;
      setIsStartingUploads(false);
    }
  }, [
    arePreparedNamesValid,
    hasUploadInProgress,
    meetingName,
    normalizedNamesById,
    preparedChunkItems,
    preparedSingleItems,
    startNextChunkUpload,
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
    sourceFileName: item.sourceFileName,
    fileSize: item.fileSize,
    lastModified: item.lastModified,
    hasFile: item.hasFile,
    saveRequested: item.saveRequested,
  }));
  const displayQueue = [...queue, ...largeQueueItems];

  return (
    <>
      <div className="upload-page-shell">
        <div className="upload-page-form" style={{ width: "700px", maxWidth: "100%" }}>
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
              className="upload-dropzone"
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
                Nhấn để chọn một hoặc nhiều tệp, hoặc kéo thả tệp vào đây.
              </h3>
              <p
                style={{
                  fontSize: "13px",
                  color: "#8d96aa",
                  margin: "0 0 20px",
                }}
              >
                Hỗ trợ MP3, M4A, MP4 và MKV · Tối đa 5GB cho mỗi tệp
              </p>
              <input
                type="file"
                accept={MEDIA_UPLOAD_ACCEPT}
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

          <div className="upload-format-note" style={{ textAlign: "center", marginBottom: "20px" }}>
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

          {/* File Queue */}
          {displayQueue.length > 0 && (
            <div
              className="upload-file-list"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                marginBottom: "24px",
              }}
            >
              <div className="upload-file-list-heading">
                <span>Tệp đã thêm ({displayQueue.length})</span>
                <span>Chỉnh tên trước khi bắt đầu tải lên</span>
              </div>
              {displayQueue.map((item) => {
                const isDone = item.phase === "success";
                const itemFileName =
                  item.fileName || item.sourceFileName || item.file?.name || "File không tên";
                const itemFileSize = Number(item.fileSize || item.file?.size || 0);
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
                const shouldShowProgress =
                  isItemUploading ||
                  isFinalizing ||
                  isPaused ||
                  isDone ||
                  isReadyToMerge ||
                  isMerging ||
                  item.progress > 0;
                const progressColor =
                  item.strategy === "chunk" ? "#f59e0b" : "#00d1ff";

                const speedBps = item.speedBps || 0;
                const uploadedBytes = itemFileSize * ((item.progress || 0) / 100);
                const remainingBytes = itemFileSize - uploadedBytes;
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
                  statusText = "Đã tải lên, chờ lưu";
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
                    className="upload-file-card"
                  >
                    {(() => {
                      const draft = getItemNameDraft(item);
                      const isEditingName = editingFileId === item.id;
                      const activeBaseName = isEditingName
                        ? editingBaseName
                        : draft.baseName;
                      const renameError = isEditingName
                        ? getRenameValidationError(item, editingBaseName)
                        : renameErrorsById.get(item.id);
                      const displayedFileName = item.phase === "idle"
                        ? `${draft.baseName}${draft.extension}`
                        : itemFileName;
                      const canRename = item.phase === "idle" && item.hasFile !== false;

                      return (
                        <>
                          <div className="upload-file-row">
                            <div className="upload-file-identity">
                              <div className="upload-file-icon" aria-hidden="true">
                                <svg
                                  width="17"
                                  height="17"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <path d="M14 2v6h6" />
                                </svg>
                              </div>
                              <div className="upload-file-details">
                                {isEditingName ? (
                                  <div className="upload-inline-editor">
                                    <div className={`upload-inline-name${renameError ? " has-error" : ""}`}>
                                      <input
                                        ref={renameInputRef}
                                        type="text"
                                        value={activeBaseName}
                                        aria-label={`Tên mới cho ${item.sourceFileName || itemFileName}`}
                                        aria-invalid={Boolean(renameError)}
                                        aria-describedby={renameError ? `rename-error-${item.id}` : undefined}
                                        onChange={(event) => {
                                          let baseName = event.target.value;
                                          if (
                                            draft.extension &&
                                            baseName
                                              .toLowerCase()
                                              .endsWith(draft.extension.toLowerCase())
                                          ) {
                                            baseName = baseName.slice(
                                              0,
                                              -draft.extension.length,
                                            );
                                          }
                                          setEditingBaseName(baseName);
                                        }}
                                        onBlur={(event) => {
                                          const editor = event.currentTarget.closest(
                                            ".upload-inline-editor",
                                          );
                                          if (!editor?.contains(event.relatedTarget)) {
                                            cancelInlineRename();
                                          }
                                        }}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            event.preventDefault();
                                            commitInlineRename(item);
                                          } else if (event.key === "Escape") {
                                            event.preventDefault();
                                            cancelInlineRename();
                                          }
                                        }}
                                      />
                                      {draft.extension && <span>{draft.extension}</span>}
                                    </div>
                                    <div className="upload-inline-actions">
                                      <button
                                        type="button"
                                        className="upload-icon-button is-confirm"
                                        onClick={() => commitInlineRename(item)}
                                        disabled={Boolean(renameError)}
                                        aria-label="Xác nhận đổi tên"
                                        title="Xác nhận (Enter)"
                                      >
                                        <CheckIcon />
                                      </button>
                                      <button
                                        type="button"
                                        className="upload-icon-button"
                                        onClick={cancelInlineRename}
                                        aria-label="Hủy đổi tên"
                                        title="Hủy (Escape)"
                                      >
                                        <XIcon />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="upload-file-title-line">
                                    <span
                                      className="upload-file-name"
                                      title={displayedFileName}
                                    >
                                      {displayedFileName || "(Chưa đặt tên)"}
                                    </span>
                                    <div className="upload-file-actions">
                                      <button
                                        type="button"
                                        className="upload-icon-button"
                                        onClick={() => {
                                          setEditingBaseName(draft.baseName);
                                          setEditingFileId(item.id);
                                        }}
                                        disabled={!canRename}
                                        aria-label={`Đổi tên ${displayedFileName}`}
                                        title={canRename ? "Đổi tên" : "Chỉ có thể đổi tên trước khi tải lên"}
                                      >
                                        <PencilIcon />
                                      </button>
                                      <button
                                        type="button"
                                        className="upload-icon-button is-danger"
                                        onClick={() => {
                                          if (editingFileId === item.id) cancelInlineRename();
                                          void removeItemFromUI(item);
                                        }}
                                        disabled={disableRemove}
                                        aria-label={`Xóa ${displayedFileName} khỏi danh sách`}
                                        title={disableRemove ? "Không thể xóa khi file đang xử lý" : "Xóa file"}
                                      >
                                        <TrashIcon />
                                      </button>
                                    </div>
                                  </div>
                                )}
                                <div className="upload-file-meta">
                                  <span>{formatBytes(itemFileSize)}</span>
                                  <span aria-hidden="true">·</span>
                                  <span style={{ color: statusColor }}>{statusText}</span>
                                  {item.strategy && (
                                    <span className={`upload-file-type ${item.strategy === "chunk" ? "is-large" : ""}`}>
                                      {item.strategy === "chunk" ? "File lớn" : "File thường"}
                                    </span>
                                  )}
                                </div>
                                {isEditingName && renameError && (
                                  <span className="upload-rename-error" id={`rename-error-${item.id}`}>
                                    {renameError}
                                  </span>
                                )}
                                {!isEditingName && canRename && renameError && (
                                  <span className="upload-rename-error" role="alert">
                                    {renameError}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}

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
                    ) : shouldShowProgress ? (
                      <>
                        <div
                          className="upload-progress-row"
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
                          className="upload-progress-meta"
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
                            {formatBytes(itemFileSize)}
                          </span>
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <section className="upload-folder-field" aria-labelledby="upload-folder-label">
            <label id="upload-folder-label" htmlFor="upload-destination-folder">
              Thư mục đích
            </label>
            <div className="upload-folder-select-wrap">
              <svg className="upload-folder-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
              </svg>
              <select
                id="upload-destination-folder"
                value={selectedFolderId}
                onChange={(event) => setSelectedFolderId(event.target.value)}
              >
                <option value="">Toàn bộ ghi chú</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {getFolderPath(folder, folders)}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="upload-folder-chevron" />
            </div>
            {folderLoadError && (
              <p className="upload-folder-error">
                Không thể tải danh sách thư mục. Tệp sẽ được lưu trong Toàn bộ ghi chú.
              </p>
            )}
          </section>

          {savedFilesSummary.length > 0 && (
            <section className="upload-saved-summary" aria-live="polite">
              <div className="upload-saved-summary-heading">
                <strong>
                  {savedFilesSummary.length === 1
                    ? "Đã lưu tệp, sẵn sàng xử lý"
                    : `Đã lưu ${savedFilesSummary.length} tệp, sẵn sàng xử lý`}
                </strong>
              </div>
              <div className="upload-saved-summary-list">
                {savedFilesSummary.slice(0, 3).map((file) => (
                  <div className="upload-saved-summary-row" key={file.id}>
                    <span className="upload-saved-summary-name" title={file.fileName}>
                      {file.fileName}
                    </span>
                    <span>{formatBytes(file.fileSize)}</span>
                    <span>
                      {file.meetingId
                        ? file.processingStarted
                          ? "Đã gửi xử lý"
                          : String(file.meetingStatus || "UNPROCESSED").toUpperCase() === "UNPROCESSED"
                            ? "Chưa xử lý"
                            : file.meetingStatus
                        : "Không tìm thấy cuộc họp"}
                    </span>
                  </div>
                ))}
                {savedFilesSummary.length > 3 && (
                  <div className="upload-saved-summary-row">
                    <span>Và {savedFilesSummary.length - 3} tệp khác</span>
                  </div>
                )}
              </div>
              {processingError && (
                <p className="upload-processing-error" role="alert">
                  {processingError}
                </p>
              )}
            </section>
          )}

          {/* Upload, save and processing actions */}
          <div
            className="upload-page-footer"
            style={{ display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" }}
          >
            {isSavingAll || savingIds.size > 0 || isChunkSaveInProgress ? (
              <button type="button" className="upload-confirm-button" disabled aria-busy="true">
                Đang lưu...
              </button>
            ) : null}

            {uploadAction.loading ? (
              <button
                type="button"
                className="upload-start-button"
                disabled
                aria-busy="true"
              >
                {uploadAction.label}
              </button>
            ) : preparedCount > 0 ? (
              <button
                type="button"
                className="upload-start-button"
                onClick={handleStartUploads}
                disabled={uploadAction.disabled}
              >
                {uploadAction.label}
              </button>
            ) : null}

            {saveableCount > 0 &&
              !isSavingAll &&
              savingIds.size === 0 &&
              !isChunkSaveInProgress && (
              <button
                type="button"
                className="upload-confirm-button"
                onClick={handleSaveAll}
                disabled={isSavingAll || savingIds.size > 0 || hasUploadInProgress}
              >
                {isSavingAll
                  ? "Đang lưu..."
                  : saveableCount > 1
                    ? "Lưu tất cả"
                    : "Xác nhận lưu"}
              </button>
            )}

            {processableSavedFiles.length > 0 && (
              <button
                type="button"
                className="upload-start-button"
                onClick={handleStartProcessing}
                disabled={isStartingProcessing || isSavingAll}
                aria-busy={isStartingProcessing}
              >
                {isStartingProcessing ? "Đang xử lý..." : "Bắt đầu xử lý"}
              </button>
            )}

            {savedFilesSummary.length > 0 &&
              processableSavedFiles.length === 0 &&
              savedFilesSummary.some((file) => file.meetingId) && (
                <button
                  type="button"
                  className="upload-start-button"
                  onClick={() => {
                    const file = savedFilesSummary.find((item) => item.meetingId);
                    if (file) navigate(`/meeting/${file.meetingId}`);
                  }}
                >
                  Xem cuộc họp
                </button>
              )}

            {preparedCount === 0 &&
              !hasUploadInProgress &&
              saveableCount === 0 &&
              savedFilesSummary.length === 0 && (
                <button type="button" className="upload-start-button" disabled={uploadAction.disabled}>
                  {uploadAction.label}
                </button>
              )}

            {savedFilesSummary.length > 0 &&
              processableSavedFiles.length === 0 &&
              !savedFilesSummary.some((file) => file.meetingId) && (
                <button type="button" className="upload-start-button" disabled>
                  Không thể bắt đầu xử lý
                </button>
              )}
          </div>
        </div>
      </div>
    </>
  );
};

export default UploadPage;
