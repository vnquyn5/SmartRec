import React, { useRef, useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  largeUploadStore,
  useLargeUploadStore,
} from "../../hooks/useLargeUploadStore";
import {
  getMediaDuration,
  LIMIT_5GB,
  LIMIT_4_HOURS_SEC,
} from "../../utils/fileSlice";
import {
  buildUploadDuplicateNotice,
  checkFilesForUploadDuplicates,
} from "../../utils/uploadDuplicateNotice";

// Helper format bytes
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const formatTime = (seconds: number): string => {
  if (!seconds || !isFinite(seconds)) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
};

const ALLOWED_EXTENSIONS = ["mp4", "mkv", "mp3", "m4a"];
const MAX_LARGE_FILES = 3;

const isValidExtension = (fileName: string): boolean => {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return ALLOWED_EXTENSIONS.includes(ext);
};

const getLargeFileKey = (file: File) =>
  `${file.name}-${file.size}-${file.lastModified}`;

type SavedFileInfo = {
  id: string;
  name: string;
  duration: number | null;
  size: number;
  status: string;
};

type DuplicateNotice = {
  title: string;
  names: string[];
};

export default function LargeFileUploadPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [durationByFileId, setDurationByFileId] = useState<
    Record<string, number>
  >({});
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(new Set());
  const [savedFiles, setSavedFiles] = useState<SavedFileInfo[]>([]);
  const [isSavingAll, setIsSavingAll] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [duplicateNotice, setDuplicateNotice] =
    useState<DuplicateNotice | null>(null);

  const largeUploadState = useLargeUploadStore();
  const visibleItems = largeUploadState.items.filter(
    (item) => !hiddenItemIds.has(item.id),
  );
  const selectedFiles = visibleItems.map((item) => item.file);
  const activeItem =
    visibleItems.find((item) => item.id === largeUploadState.activeItemId) ||
    visibleItems[0] ||
    null;
  const selectedFile = activeItem?.file || null;
  const chunks = activeItem?.chunks || [];
  const fileDuration = activeItem
    ? (durationByFileId[activeItem.id] ?? null)
    : null;
  const readyToSaveItems = visibleItems.filter(
    (item) => item.phase === "ready_to_merge",
  );

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("[duplicate-notice:state]", duplicateNotice);
    }
  }, [duplicateNotice]);

  useEffect(() => {
    if (activeItem && activeItem.id !== largeUploadState.activeItemId) {
      largeUploadStore.selectItem(activeItem.id);
    }
  }, [activeItem?.id, largeUploadState.activeItemId]);

  // Nếu nhận file từ trang Upload chính (qua navigate state)
  useEffect(() => {
    if (location.state?.file) {
      validateAndProcessFiles(
        [location.state.file],
        Boolean(location.state?.autoStart),
      );
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateAndProcessFiles = async (files: File[], autoStart = false) => {
    setErrorMessage("");
    setDuplicateNotice(null);

    const limitedFiles = files.slice(0, MAX_LARGE_FILES);
    const validFiles: File[] = [];
    for (const file of limitedFiles) {
      if (!isValidExtension(file.name)) {
        setErrorMessage("Chỉ chấp nhận định dạng .mp4, .mkv, .mp3, .m4a");
        continue;
      }

      if (file.size > LIMIT_5GB) {
        setErrorMessage("Dung lượng vượt quá giới hạn 5GB!");
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    let duplicateNames: string[] = [];
    let uploadableFiles: File[] = [];
    const duplicateMetadataById: Record<
      string,
      { quickFingerprint?: string | null; checksumSha256?: string | null } | null
    > = {};
    try {
      const duplicateCheckResult = await checkFilesForUploadDuplicates(
        validFiles,
        {
          getIdentity: getLargeFileKey,
          forceFullChecksum: () => true,
        },
      );

      duplicateNames = duplicateCheckResult.duplicateItems.map(
        ({ duplicate }) => duplicate.existingFileName,
      );
      uploadableFiles = duplicateCheckResult.uploadableFiles;
      if (import.meta.env.DEV) {
        console.log("[large-upload-page:duplicate-result]", {
          totalValidFiles: validFiles.length,
          duplicates: duplicateCheckResult.duplicateItems.map(
            ({ file, duplicate }) => ({
              selectedFileName: file.name,
              selectedFileSize: file.size,
              existingFileName: duplicate.existingFileName,
              mediaFileId: duplicate.mediaFileId,
            }),
          ),
          uploadableFiles: uploadableFiles.map((file) => ({
            fileName: file.name,
            fileSize: file.size,
          })),
        });
      }
      uploadableFiles.forEach((file) => {
        duplicateMetadataById[getLargeFileKey(file)] =
          duplicateCheckResult.metadataByIdentity.get(getLargeFileKey(file)) ||
          null;
      });
    } catch {
      setErrorMessage(
        "Không thể kiểm tra file trùng từ hệ thống. Vui lòng thử lại.",
      );
      return;
    }

    if (duplicateNames.length > 0) {
      const notice = buildUploadDuplicateNotice(duplicateNames, validFiles.length);
      if (import.meta.env.DEV) {
        console.log("[duplicate-notice:set]", notice);
      }
      setDuplicateNotice(notice);
    }

    if (uploadableFiles.length === 0) {
      if (import.meta.env.DEV) {
        console.log("[large-upload-page:stop-before-queue]", {
          reason: "no-uploadable-files",
          duplicateCount: duplicateNames.length,
        });
      }
      return;
    }

    const durationUpdates: Record<string, number> = {};

    for (const file of uploadableFiles) {
      try {
        const duration = await getMediaDuration(file);
        if (duration > LIMIT_4_HOURS_SEC) {
          setErrorMessage("Thời lượng media vượt quá giới hạn 4 giờ!");
          return;
        }
        durationUpdates[getLargeFileKey(file)] = duration;
      } catch (e) {
        console.warn("Could not read duration", e);
      }
    }

    setDurationByFileId((current) => ({ ...current, ...durationUpdates }));
    setHiddenItemIds((current) => {
      const next = new Set(current);
      uploadableFiles.forEach((file) => next.delete(getLargeFileKey(file)));
      return next;
    });
    if (import.meta.env.DEV) {
      console.log("[large-upload-page:add-files]", {
        autoStart,
        files: uploadableFiles.map((file) => ({
          fileName: file.name,
          fileSize: file.size,
          id: getLargeFileKey(file),
          duplicateMetadata: duplicateMetadataById[getLargeFileKey(file)] || null,
        })),
      });
    }
    largeUploadStore.addFiles(uploadableFiles, duplicateMetadataById);
    if (autoStart) {
      if (import.meta.env.DEV) {
        console.log("[large-upload-page:autostart]");
      }
      window.setTimeout(() => largeUploadStore.start(), 0);
    }
  };

  const handleStartUpload = () => {
    largeUploadStore.start(activeItem?.id);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndProcessFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndProcessFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleHideFile = () => {
    if (activeItem) {
      setHiddenItemIds((current) => new Set(current).add(activeItem.id));
    }
    setErrorMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCancelAndReturn = () => {
    largeUploadStore.cancel();
    navigate("/upload");
  };

  const handleBackToUpload = () => navigate("/upload");

  const buildSavedInfo = (
    item: NonNullable<typeof activeItem>,
  ): SavedFileInfo => ({
    id: item.id,
    name:
      (item.mergeResponse as { fileName?: string } | null)?.fileName ||
      item.file.name,
    duration: durationByFileId[item.id] ?? null,
    size: item.file.size,
    status: "Lưu thành công",
  });

  const handleSaveCurrent = async () => {
    const canMerge =
      activeItem?.phase === "ready_to_merge" ||
      (activeItem?.phase === "merge_failed" &&
        activeItem.uploadedChunkIndexes.length === activeItem.chunks.length &&
        !activeItem.mergeStarted);
    if (!activeItem || !canMerge) return;
    const savedItem = await largeUploadStore.merge(activeItem.id);
    if (savedItem?.phase === "success") {
      setSavedFiles([buildSavedInfo(savedItem)]);
    }
  };

  const handleSaveAll = async () => {
    if (readyToSaveItems.length < 2 || isSavingAll) return;
    setIsSavingAll(true);
    const successfulItems: SavedFileInfo[] = [];

    for (const item of readyToSaveItems) {
      const savedItem = await largeUploadStore.merge(item.id);
      if (savedItem?.phase === "success") {
        successfulItems.push(buildSavedInfo(savedItem));
      }
    }

    setIsSavingAll(false);
    if (successfulItems.length === readyToSaveItems.length) {
      setSavedFiles(successfulItems);
    }
  };

  // Tính toán hiển thị
  const isUploading =
    activeItem?.phase === "uploading" || activeItem?.phase === "paused";
  const isPaused = activeItem?.phase === "paused";
  const isReadyToMerge = activeItem?.phase === "ready_to_merge";
  const isMerging = activeItem?.phase === "merging";
  const canRetryMerge =
    activeItem?.phase === "merge_failed" &&
    activeItem.uploadedChunkIndexes.length === activeItem.chunks.length &&
    !activeItem.mergeStarted;
  const uploadedBytes = activeItem?.uploadedChunks
    ? activeItem.uploadedChunks * (chunks[0]?.size || 0)
    : 0;
  const remainingBytes = selectedFile ? selectedFile.size - uploadedBytes : 0;
  const remainingSeconds =
    activeItem?.speedBps && activeItem.speedBps > 0
      ? remainingBytes / activeItem.speedBps
      : 0;

  const isDone = activeItem?.phase === "success";

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
              Chunked Upload
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
              Tải lên file ghi âm/ghi hình (trên 2GB, tối đa 5GB). Chunked
              Upload để đảm bảo tốc độ và độ ổn định. Tối đa {MAX_LARGE_FILES}{" "}
              file mỗi lần.
            </p>
          </div>

          {/* Dropzone */}
          {!selectedFile && (
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
              onClick={() => fileInputRef.current?.click()}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  background: "rgba(245, 158, 11, 0.1)",
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
                  stroke="#f59e0b"
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
                Hỗ trợ file trên 2GB đến 5GB · MP4 / MKV / MP3 / M4A · Tối đa{" "}
                {MAX_LARGE_FILES} file
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
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
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
                  background: "#f59e0b",
                  borderRadius: "50%",
                }}
              ></span>
              Chunked Upload · Tối đa 5GB · Tối đa {MAX_LARGE_FILES} file · Hỗ
              trợ Pause/Resume
            </span>
          </div>

          {/* Error */}
          {errorMessage && (
            <div
              style={{
                padding: "12px 16px",
                background: "rgba(255, 92, 92, 0.1)",
                color: "#ff5c5c",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "13px",
                border: "1px solid rgba(255, 92, 92, 0.25)",
              }}
            >
              {errorMessage}
            </div>
          )}

          {duplicateNotice && (
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
              <div style={{ fontWeight: "600" }}>{duplicateNotice.title}</div>
              {duplicateNotice.names.length > 0 && (
                <ul style={{ margin: "8px 0 0", paddingLeft: "18px" }}>
                  {duplicateNotice.names.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* File Queue Card */}
          {selectedFiles.length > 1 && (
            <div
              style={{
                marginBottom: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {selectedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${file.size}-${index}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    background:
                      file === selectedFile
                        ? "rgba(245, 158, 11, 0.08)"
                        : "rgba(255,255,255,0.02)",
                    color: file === selectedFile ? "#fff" : "#8d96aa",
                    fontSize: "12px",
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {file.name}
                  </span>
                  <span style={{ flexShrink: 0, marginLeft: "12px" }}>
                    {file === selectedFile ? "Đang chọn" : "Trong hàng chờ"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {readyToSaveItems.length >= 2 && (
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
                disabled={isSavingAll}
                style={{
                  background: isSavingAll
                    ? "rgba(255,255,255,0.08)"
                    : "linear-gradient(135deg, #22c55e, #16a34a)",
                  border: "none",
                  color: isSavingAll ? "#576176" : "#fff",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: isSavingAll ? "not-allowed" : "pointer",
                }}
              >
                {isSavingAll ? "Đang lưu..." : "Lưu tất cả"}
              </button>
            </div>
          )}

          {selectedFile && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                marginBottom: "24px",
              }}
            >
              <div
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
                        background: "rgba(245, 158, 11, 0.1)",
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
                        stroke="#f59e0b"
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
                          color: "#fff",
                          marginBottom: "4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {selectedFile.name}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: isDone
                            ? "#22c55e"
                            : isReadyToMerge
                              ? "#22c55e"
                              : isMerging
                                ? "#f59e0b"
                                : isUploading
                                  ? "#3e89ff"
                                  : "#8d96aa",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>{formatBytes(selectedFile.size)}</span>
                        <span style={{ color: "#576176" }}>-</span>
                        <span>
                          {isDone
                            ? "Hoàn thành"
                            : isMerging
                              ? "Đang lưu"
                              : canRetryMerge
                                ? "Merge thất bại"
                                : isReadyToMerge
                                  ? "Sẵn sàng lưu"
                                  : isPaused
                                    ? "Tạm dừng"
                                    : isUploading
                                      ? "Đang tải lên"
                                      : "Sẵn sàng tải lên"}
                        </span>
                        {fileDuration != null && fileDuration > 0 && (
                          <span style={{ color: "#576176" }}>
                            · {formatTime(fileDuration)}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: "700",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            background: "rgba(245, 158, 11, 0.15)",
                            color: "#f59e0b",
                            border: "1px solid rgba(245, 158, 11, 0.3)",
                          }}
                        >
                          Chunked
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleHideFile}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#576176",
                      cursor: "pointer",
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

                {/* Progress bar */}
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
                        width: `${activeItem?.progress || 0}%`,
                        height: "100%",
                        background:
                          isDone || isReadyToMerge
                            ? "#22c55e"
                            : isPaused
                              ? "#f59e0b"
                              : "#f59e0b",
                        transition: "width 0.15s linear",
                      }}
                    ></div>
                  </div>

                  {/* Nút Upload khi chưa bắt đầu */}
                  {!isUploading &&
                    !isDone &&
                    !isReadyToMerge &&
                    !isMerging &&
                    !canRetryMerge && (
                      <button
                        type="button"
                        onClick={() => handleStartUpload()}
                        style={{
                          background:
                            "linear-gradient(135deg, #f59e0b, #d97706)",
                          border: "none",
                          color: "#fff",
                          padding: "6px 16px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "700",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        Upload
                      </button>
                    )}

                  {/* Nút Pause/Resume khi đang upload */}
                  {isUploading && !isDone && (
                    <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (isPaused) {
                            largeUploadStore.resume();
                          } else {
                            largeUploadStore.pause();
                          }
                        }}
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
                        onClick={handleCancelAndReturn}
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
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Nút Lưu khi đã upload đủ chunk */}
                  {(isReadyToMerge || isMerging || canRetryMerge) && (
                    <button
                      type="button"
                      onClick={handleSaveCurrent}
                      disabled={isMerging || isSavingAll}
                      style={{
                        background:
                          isMerging || isSavingAll
                            ? "rgba(255,255,255,0.08)"
                            : "linear-gradient(135deg, #22c55e, #16a34a)",
                        border: "none",
                        color: isMerging || isSavingAll ? "#576176" : "#fff",
                        padding: "6px 16px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: "700",
                        cursor:
                          isMerging || isSavingAll ? "not-allowed" : "pointer",
                        flexShrink: 0,
                      }}
                    >
                      {isMerging
                        ? "Đang gộp file..."
                        : canRetryMerge
                          ? "Thử lại merge"
                          : "Lưu"}
                    </button>
                  )}
                </div>

                {/* Thông tin chi tiết */}
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
                      {activeItem?.progress || 0}% hoàn thành
                      <span style={{ marginLeft: "8px", color: "#f59e0b" }}>
                        (Đang tải lên {activeItem?.uploadedChunks || 0}/
                        {chunks.length})
                      </span>
                    </span>
                    {isUploading && !isPaused && (
                      <span style={{ color: "#8d96aa", fontSize: "10px" }}>
                        Speed:{" "}
                        {activeItem?.speedBps && activeItem.speedBps > 0
                          ? `${formatBytes(activeItem.speedBps)}/s`
                          : "0 MB/s"}{" "}
                        • Remaining: ~{formatTime(remainingSeconds)}
                      </span>
                    )}
                    {activeItem?.retryCount && activeItem.retryCount > 0 ? (
                      <span style={{ color: "#ff5c5c", fontSize: "10px" }}>
                        Retry: {activeItem.retryCount}
                      </span>
                    ) : null}
                  </div>
                  <span>
                    {formatBytes(uploadedBytes)} /{" "}
                    {formatBytes(selectedFile.size)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
            }}
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
                handleBackToUpload();
              }}
            >
              ← Quay lại
            </button>
            {isDone && (
              <button
                className="sr-button sr-button-primary"
                style={{
                  minHeight: "36px",
                  height: "36px",
                  width: "auto",
                  padding: "0 24px",
                  fontSize: "13px",
                }}
                onClick={() => navigate("/history")}
              >
                Tiếp tục
              </button>
            )}
          </div>
        </div>
      </div>
      {savedFiles.length > 0 && (
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
              width: "460px",
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
                  {savedFiles.length === 1
                    ? "File đã được lưu vào hệ thống."
                    : `${savedFiles.length} file đã được lưu vào hệ thống.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSavedFiles([])}
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
              {savedFiles.map((file) => (
                <div
                  key={file.id}
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
                    {file.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      color: "#8d96aa",
                      fontSize: "12px",
                    }}
                  >
                    <span>
                      Thời lượng:{" "}
                      {file.duration ? formatTime(file.duration) : "Không có"}
                    </span>
                    <span>·</span>
                    <span>Kích thước: {formatBytes(file.size)}</span>
                    <span>·</span>
                    <span style={{ color: "#22c55e" }}>{file.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
