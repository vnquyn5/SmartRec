import React, { useRef, useState, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import TopBar from "../../components/layout/TopBar";
import { useChunkQueue } from "../../hooks/useChunkQueue";
import {
  sliceFileToBlobs,
  getMediaDuration,
  LIMIT_5GB,
  LIMIT_4_HOURS_SEC,
} from "../../utils/fileSlice";

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

const isValidExtension = (fileName: string): boolean => {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return ALLOWED_EXTENSIONS.includes(ext);
};

export default function LargeFileUploadPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [chunks, setChunks] = useState<any[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [uploadComplete, setUploadComplete] = useState<boolean>(false);

  const chunkedUpload = useChunkQueue();

  // Nếu nhận file từ trang Upload chính (qua navigate state)
  useEffect(() => {
    if (location.state?.file) {
      validateAndProcessFile(location.state.file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateAndProcessFile = async (file: File) => {
    setErrorMessage("");
    setSelectedFile(null);
    setFileDuration(null);
    setUploadComplete(false);

    if (!isValidExtension(file.name)) {
      setErrorMessage("Chỉ chấp nhận định dạng .mp4, .mkv, .mp3, .m4a");
      return;
    }

    if (file.size > LIMIT_5GB) {
      setErrorMessage("Dung lượng vượt quá giới hạn 5GB!");
      return;
    }

    try {
      const duration = await getMediaDuration(file);
      if (duration > LIMIT_4_HOURS_SEC) {
        setErrorMessage("Thời lượng media vượt quá giới hạn 4 giờ!");
        return;
      }
      setFileDuration(duration);
    } catch (e) {
      console.warn("Could not read duration", e);
    }

    setSelectedFile(file);
    const generatedChunks = sliceFileToBlobs(file);
    setChunks(generatedChunks);
  };

  // --- MOCK API ---
  const mockUploadChunkApi = async (data: any, signal: AbortSignal): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 300);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Upload aborted"));
      });
    });
  };

  const handleStartUpload = () => {
    if (!selectedFile || chunks.length === 0) return;
    setUploadComplete(false);
    chunkedUpload.startUpload({
      file: selectedFile,
      chunks,
      concurrency: 3,
      uploadChunkFn: mockUploadChunkApi,
      onSuccess: () => setUploadComplete(true),
      onError: (err) => setErrorMessage(`Lỗi: ${err.message}`),
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndProcessFile(e.target.files[0]);
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
      if (e.dataTransfer.files.length > 1) {
        setErrorMessage("Vui lòng chỉ tải lên duy nhất 1 file!");
        return;
      }
      validateAndProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleRemoveFile = () => {
    chunkedUpload.cancelUpload();
    setSelectedFile(null);
    setChunks([]);
    setErrorMessage("");
    setUploadComplete(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Tính toán hiển thị
  const isUploading = chunkedUpload.isUploading || chunkedUpload.isPaused;
  const uploadedBytes =
    chunkedUpload.uploadedChunks * (chunks[0]?.size || 0);
  const remainingBytes = selectedFile ? selectedFile.size - uploadedBytes : 0;
  const remainingSeconds =
    chunkedUpload.speedBps > 0 ? remainingBytes / chunkedUpload.speedBps : 0;

  const isDone = uploadComplete;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "var(--sr-bg)",
      }}
    >
      <TopBar hideSearch={true} />

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
              Tải lên file ghi âm/ghi hình (trên 2GB, tối đa
              5GB). Chunked Upload để đảm bảo tốc độ và độ
              ổn định.
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
                Hỗ trợ file trên 2GB đến 5GB · MP4 / MKV / MP3
              </p>
              <input
                type="file"
                accept=".mp4,.mkv,.mp3"
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
              Chunked Upload · Tối đa 5GB · Hỗ trợ Pause/Resume
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

          {/* File Queue Card */}
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
                            : chunkedUpload.isPaused
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
                    onClick={handleRemoveFile}
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
                        width: `${chunkedUpload.progress}%`,
                        height: "100%",
                        background: isDone
                          ? "#22c55e"
                          : chunkedUpload.isPaused
                            ? "#f59e0b"
                            : "#f59e0b",
                        transition: "width 0.15s linear",
                      }}
                    ></div>
                  </div>

                  {/* Nút Upload khi chưa bắt đầu */}
                  {!isUploading && !isDone && (
                    <button
                      type="button"
                      onClick={handleStartUpload}
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
                        onClick={
                          chunkedUpload.isPaused
                            ? chunkedUpload.resumeUpload
                            : chunkedUpload.pauseUpload
                        }
                        style={{
                          background: chunkedUpload.isPaused
                            ? "rgba(34, 197, 94, 0.15)"
                            : "rgba(245, 158, 11, 0.15)",
                          border: chunkedUpload.isPaused
                            ? "1px solid rgba(34, 197, 94, 0.3)"
                            : "1px solid rgba(245, 158, 11, 0.3)",
                          color: chunkedUpload.isPaused
                            ? "#22c55e"
                            : "#f59e0b",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "700",
                          cursor: "pointer",
                        }}
                      >
                        {chunkedUpload.isPaused ? "Resume" : "Pause"}
                      </button>
                      <button
                        type="button"
                        onClick={handleRemoveFile}
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

                  {/* Nút Lưu khi hoàn thành */}
                  {isDone && (
                    <button
                      type="button"
                      onClick={() => navigate("/history")}
                      style={{
                        background:
                          "linear-gradient(135deg, #22c55e, #16a34a)",
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
                      Lưu
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
                      {chunkedUpload.progress}% hoàn thành
                      <span
                        style={{ marginLeft: "8px", color: "#f59e0b" }}
                      >
                        (Chunk {chunkedUpload.uploadedChunks}/{chunks.length})
                      </span>
                    </span>
                    {isUploading && !chunkedUpload.isPaused && (
                      <span style={{ color: "#8d96aa", fontSize: "10px" }}>
                        Speed:{" "}
                        {chunkedUpload.speedBps > 0
                          ? `${formatBytes(chunkedUpload.speedBps)}/s`
                          : "0 MB/s"}{" "}
                        • Remaining: ~{formatTime(remainingSeconds)}
                      </span>
                    )}
                    {chunkedUpload.retryCount > 0 && (
                      <span style={{ color: "#ff5c5c", fontSize: "10px" }}>
                        Retry: {chunkedUpload.retryCount}
                      </span>
                    )}
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
                chunkedUpload.cancelUpload();
                navigate("/upload");
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
    </div>
  );
}
