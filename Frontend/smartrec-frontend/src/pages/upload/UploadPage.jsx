import React, { useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import TopBar from "../../components/layout/TopBar";
import { uploadSingleFile } from "../../features/files/useSingleUpload";

// Helper format bytes
const formatBytes = (bytes) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

// Allowed extensions
const ALLOWED_EXTENSIONS = ["mp4", "mkv", "mp3", "m4a"];
const MAX_FILES = 5;
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

// Kiểm tra extension hợp lệ
const isValidExtension = (fileName) => {
  const ext = fileName.split(".").pop().toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
};

const UploadPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Queue: mảng các file item
  const [queue, setQueue] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [savedNotification, setSavedNotification] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  // Cập nhật 1 item trong queue theo id
  const updateItem = useCallback((id, updates) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    );
  }, []);

  // Bắt đầu upload 1 file
  const startUpload = useCallback(
    async (fileItem) => {
      const controller = new AbortController();
      const id = fileItem.id;

      setQueue((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, abortController: controller } : item,
        ),
      );

      updateItem(id, { phase: "uploading", strategy: "single", error: null });

      try {
        const uploadResponse = await uploadSingleFile(
          fileItem.file,
          "",
          controller.signal,
          (event) => {
            if (event.total) {
              updateItem(id, {
                progress: Math.round((event.loaded / event.total) * 100),
              });
            }
          },
        );
        updateItem(id, { phase: "success", progress: 100, uploadResponse });
      } catch (err) {
        if (err.kind === "canceled" || err.message === "canceled") {
          updateItem(id, { phase: "idle", progress: 0 });
        } else {
          updateItem(id, {
            phase: "error",
            error: err.message || "Upload thất bại",
          });
        }
      }
    },
    [meetingName, updateItem],
  );

  // Xử lý thêm file(s) vào queue
  const addFilesToQueue = useCallback((files) => {
    const fileArray = Array.from(files);
    // Chỉ đếm những file chưa hoàn thành (đang queue, uploading hoặc error)
    const activeCount = queue.filter(item => item.phase !== 'success').length;

    const validFiles = [];
    for (const file of fileArray) {
      if (!isValidExtension(file.name)) {
        alert(
          `File "${file.name}" không được hỗ trợ. Chỉ chấp nhận .mp4, .mkv, .mp3, .m4a`,
        );
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" vượt quá giới hạn 2GB.`);
        continue;
      }
      validFiles.push(file);
    }

    if (activeCount >= MAX_FILES) {
      alert(`Đã đạt tối đa ${MAX_FILES} file đang xử lý. Vui lòng chờ tải xong hoặc dọn dẹp hàng đợi để tải lên tiếp.`);
      return;
    }

    const availableSlots = MAX_FILES - activeCount;
    const filesToAdd = validFiles.slice(0, availableSlots);
    
    if (validFiles.length > availableSlots) {
      alert(`Chỉ được xử lý tối đa ${MAX_FILES} file cùng lúc. Đã tự động chọn ${availableSlots} file đầu tiên.`);
    }

    if (filesToAdd.length === 0) return;

    const newItems = filesToAdd.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      customName: file.name,
      phase: "idle",
      progress: 0,
      strategy: "single",
      chunkInfo: null,
      error: null,
      saved: false,
      uploadResponse: null,
      abortController: null,
    }));

    setQueue((prev) => [...prev, ...newItems]);

    setTimeout(() => {
      newItems.forEach((item) => startUpload(item));
    }, 100);
  }, [queue, startUpload]);

  // Xử lý chọn file qua input
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
      e.target.value = "";
    }
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  // Xóa 1 file khỏi queue
  const handleRemoveFile = useCallback((id) => {
    setQueue((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item && item.abortController) {
        item.abortController.abort();
      }
      const newQueue = prev.filter((i) => i.id !== id);
      return newQueue;
    });
  }, []);

  const handleProcessFile = useCallback((id) => {
    alert('Tệp của bạn sẽ được xử lý. Hãy theo dõi ở Workspace.');
    handleRemoveFile(id);
  }, [handleRemoveFile]);

  const handleSaveRename = useCallback((id) => {
    if (editName.trim()) {
      updateItem(id, { customName: editName.trim() });
    }
    setEditingId(null);
  }, [editName, updateItem]);

  const activeCount = queue.filter(item => item.phase !== 'success').length;
  const canAddMore = activeCount < MAX_FILES;

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
              Nạp file cuộc họp
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
              phân tích và tạo bản ghi. Tối đa {MAX_FILES} file mỗi lần.
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
              onClick={() => fileInputRef.current?.click()}
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
                Hỗ trợ tải lên tối đa {MAX_FILES} file đang xử lý ({activeCount}/{MAX_FILES})
              </p>
              <input
                type="file"
                accept=".mp4,.mkv,.mp3"
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
                  background: "#8d96aa",
                  borderRadius: "50%",
                }}
              ></span>
              Định dạng hỗ trợ: .mp4, .mkv, .mp3 - Tối đa {MAX_FILES} file mỗi
              lần
            </span>
          </div>

          {/* File Queue */}
          {queue.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                marginBottom: "24px",
              }}
            >
              {queue.map((item) => {
                const isDone = item.phase === "success";
                const isError = item.phase === "error";
                const isItemUploading = item.phase === "uploading";
                const progressColor =
                  item.strategy === "chunk" ? "#f59e0b" : "#00d1ff";

                let statusText = "";
                let statusColor = "#8d96aa";
                if (item.phase === "idle") {
                  statusText = "Sẵn sàng tải lên";
                  statusColor = "#8d96aa";
                } else if (isItemUploading) {
                  statusText = "Đang tải lên";
                  statusColor = "#3e89ff";
                } else if (isDone && !item.saved) {
                  statusText = "Hoàn thành";
                  statusColor = "#22c55e";
                } else if (isDone && item.saved) {
                  statusText = "Đã lưu";
                  statusColor = "#22c55e";
                } else if (isError) {
                  statusText = "Lỗi";
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
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            {editingId === item.id ? (
                              <input
                                autoFocus
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onBlur={() => handleSaveRename(item.id)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(item.id); }}
                                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid #3e89ff', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: '14px', fontWeight: '700', width: '100%', maxWidth: '300px' }}
                              />
                            ) : (
                              <>
                                <div style={{ fontSize: '14px', fontWeight: '700', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {item.customName || item.file.name}
                                </div>
                                {isDone && (
                                  <button onClick={() => { setEditingId(item.id); setEditName(item.customName || item.file.name); }} style={{ background: 'transparent', border: 'none', color: '#8d96aa', cursor: 'pointer', padding: '2px', display: 'flex' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M12 20h9"></path>
                                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                    </svg>
                                  </button>
                                )}
                              </>
                            )}
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
                                  textTransform: "uppercase",
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
                                  ? "Chunked"
                                  : "Single"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveFile(item.id)}
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

                    {/* Progress bar + Save button */}
                    {isError ? (
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
                                background: isDone ? "#22c55e" : progressColor,
                                transition: "width 0.15s linear",
                              }}
                            ></div>
                          </div>
                          {isDone && (
                            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                              <button
                                onClick={() => handleRemoveFile(item.id)}
                                style={{
                                  background: 'rgba(255,255,255,0.1)',
                                  border: 'none',
                                  color: '#fff',
                                  padding: '6px 16px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: '700',
                                  cursor: 'pointer',
                                }}
                              >
                                Hoàn thành
                              </button>
                              <button
                                onClick={() => handleProcessFile(item.id)}
                                style={{
                                  background: 'linear-gradient(135deg, #3e89ff, #2563eb)',
                                  border: 'none',
                                  color: '#fff',
                                  padding: '6px 16px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: '700',
                                  cursor: 'pointer',
                                }}
                              >
                                Xử lý
                              </button>
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "11px",
                            color: "#576176",
                            marginTop: "8px",
                          }}
                        >
                          <span>
                            {item.progress}% hoàn thành
                            {item.chunkInfo && (
                              <span
                                style={{ marginLeft: "8px", color: "#f59e0b" }}
                              >
                                (Chunk {item.chunkInfo.current}/
                                {item.chunkInfo.total})
                              </span>
                            )}
                          </span>
                          <span>
                            {formatBytes(
                              item.file.size * (item.progress / 100),
                            )}{" "}
                            / {formatBytes(item.file.size)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Action buttons removed */}
        </div>
      </div>
    </div>
  );
};

export default UploadPage;
