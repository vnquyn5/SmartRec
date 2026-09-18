import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../../components/layout/TopBar';

const STORAGE_KEY = 'smartrec_saved_uploads';

// Helper format bytes
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Allowed extensions
const ALLOWED_EXTENSIONS = ['mp4', 'mkv', 'mp3'];
const MAX_FILES = 5;
const CHUNK_THRESHOLD = 2 * 1024 * 1024 * 1024; // 2GB

// Kiểm tra extension hợp lệ
const isValidExtension = (fileName) => {
  const ext = fileName.split('.').pop().toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
};

// Giả lập upload single file (mock)
const mockSingleUpload = (file, signal, onProgress) => {
  return new Promise((resolve, reject) => {
    let currentProgress = 0;
    const interval = setInterval(() => {
      if (signal.aborted) {
        clearInterval(interval);
        reject(new Error('canceled'));
        return;
      }
      currentProgress += 10;
      if (currentProgress > 100) currentProgress = 100;
      onProgress(currentProgress);
      if (currentProgress === 100) {
        clearInterval(interval);
        setTimeout(() => resolve(), 500);
      }
    }, 300);
  });
};

// Giả lập upload chunked file (mock)
const mockChunkUpload = (file, signal, onProgress, onChunkInfo) => {
  const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  onChunkInfo({ current: 0, total: totalChunks });

  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < totalChunks; i++) {
      if (signal.aborted) { reject(new Error('canceled')); return; }
      onChunkInfo({ current: i + 1, total: totalChunks });
      await new Promise((res, rej) => {
        const timeout = setTimeout(res, 300);
        signal.addEventListener('abort', () => { clearTimeout(timeout); rej(new Error('canceled')); }, { once: true });
      });
      const overallProgress = Math.round(((i + 1) / totalChunks) * 100);
      onProgress(overallProgress);
    }
    resolve();
  });
};

const UploadPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Queue: mảng các file item
  const [queue, setQueue] = useState([]);
  const [meetingName, setMeetingName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [savedNotification, setSavedNotification] = useState(null);

  // Khôi phục file đã lưu từ localStorage khi vào trang
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const savedItems = JSON.parse(stored);
        const restoredItems = savedItems.map(item => ({
          id: item.id,
          file: { name: item.fileName, size: item.fileSize }, // Mock file object với name + size
          phase: 'done',
          progress: 100,
          strategy: item.strategy || 'single',
          chunkInfo: null,
          error: null,
          saved: true,
          abortController: null,
        }));
        if (restoredItems.length > 0) {
          setQueue(restoredItems);
        }
      }
    } catch (e) {
      console.error('Lỗi khôi phục file từ localStorage:', e);
    }
  }, []);

  // Hàm lưu danh sách saved vào localStorage
  const persistToStorage = useCallback((items) => {
    const savedItems = items
      .filter(item => item.saved)
      .map(item => ({
        id: item.id,
        fileName: item.file.name,
        fileSize: item.file.size,
        strategy: item.strategy,
      }));
    if (savedItems.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedItems));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Cập nhật 1 item trong queue theo id
  const updateItem = useCallback((id, updates) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  }, []);

  // Bắt đầu upload 1 file
  const startUpload = useCallback(async (fileItem) => {
    const controller = new AbortController();
    const id = fileItem.id;

    setQueue(prev => prev.map(item => item.id === id ? { ...item, abortController: controller } : item));

    const isChunked = fileItem.file.size > CHUNK_THRESHOLD;
    const strategy = isChunked ? 'chunk' : 'single';

    updateItem(id, { phase: 'uploading', strategy });

    try {
      if (isChunked) {
        await mockChunkUpload(
          fileItem.file,
          controller.signal,
          (progress) => updateItem(id, { progress }),
          (chunkInfo) => updateItem(id, { chunkInfo })
        );
      } else {
        await mockSingleUpload(
          fileItem.file,
          controller.signal,
          (progress) => updateItem(id, { progress })
        );
      }
      updateItem(id, { phase: 'done', progress: 100 });
    } catch (err) {
      if (err.message === 'canceled') {
        updateItem(id, { phase: 'idle', progress: 0 });
      } else {
        updateItem(id, { phase: 'error', error: err.message });
      }
    }
  }, [updateItem]);

  // Xử lý thêm file(s) vào queue
  const addFilesToQueue = useCallback((files) => {
    const fileArray = Array.from(files);
    const currentCount = queue.length;

    const validFiles = [];
    for (const file of fileArray) {
      if (!isValidExtension(file.name)) {
        alert(`File "${file.name}" không được hỗ trợ. Chỉ chấp nhận .mp4, .mkv, .mp3`);
        continue;
      }
      validFiles.push(file);
    }

    if (currentCount + validFiles.length > MAX_FILES) {
      alert(`Chỉ được upload tối đa ${MAX_FILES} file. Hiện tại đã có ${currentCount} file trong hàng đợi.`);
      return;
    }

    if (validFiles.length === 0) return;

    const newItems = validFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      phase: 'queued',
      progress: 0,
      strategy: null,
      chunkInfo: null,
      error: null,
      saved: false,
      abortController: null,
    }));

    setQueue(prev => [...prev, ...newItems]);

    setTimeout(() => {
      newItems.forEach(item => startUpload(item));
    }, 100);
  }, [queue.length, startUpload]);

  // Xử lý chọn file qua input
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
      e.target.value = '';
    }
  };

  // Xử lý kéo thả
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  // Xóa 1 file khỏi queue
  const handleRemoveFile = useCallback((id) => {
    setQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (item && item.abortController) {
        item.abortController.abort();
      }
      const newQueue = prev.filter(i => i.id !== id);
      // Cập nhật localStorage khi xóa file đã lưu
      persistToStorage(newQueue);
      return newQueue;
    });
  }, [persistToStorage]);

  // Lưu file đã hoàn thành + persist vào localStorage
  const handleSaveFile = useCallback((id) => {
    setQueue(prev => {
      const updated = prev.map(item => item.id === id ? { ...item, saved: true } : item);
      persistToStorage(updated);
      return updated;
    });
    setSavedNotification('Đã lưu thành công!');
    setTimeout(() => setSavedNotification(null), 3000);
  }, [persistToStorage]);

  // Bắt đầu xử lý: xóa hết queue + localStorage
  const handleStartProcessing = useCallback(() => {
    alert('Bắt đầu xử lý tất cả bản ghi!');
    setQueue([]);
    setMeetingName('');
    setSavedNotification(null);
    localStorage.removeItem(STORAGE_KEY);
    navigate('/');
  }, [navigate]);

  const hasUploading = queue.some(item => item.phase === 'uploading');
  const canAddMore = queue.length < MAX_FILES;
  const allSaved = queue.length > 0 && queue.every(item => item.saved === true);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--sr-bg)' }}>
      <TopBar hideSearch={true} />

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '24px', paddingTop: '40px' }}>
        <div style={{ width: '700px', maxWidth: '100%' }}>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#fff', marginBottom: '8px' }}>Nạp file cuộc họp</h1>
            <p style={{ fontSize: '12px', color: '#8d96aa', maxWidth: '460px', margin: '0 auto', lineHeight: '1.6' }}>
              Tải lên một hoặc nhiều file ghi âm/ghi hình đã có sẵn để hệ thống phân tích và tạo bản ghi. Tối đa {MAX_FILES} file mỗi lần.
            </p>
          </div>

          {/* Thông báo đã lưu */}
          {savedNotification && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(34, 197, 94, 0.1)',
              color: '#22c55e',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '13px',
              border: '1px solid rgba(34, 197, 94, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <span style={{ fontWeight: '600' }}>{savedNotification}</span>
            </div>
          )}

          {/* Dropzone */}
          {canAddMore && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: isDragging ? '2px dashed #3e89ff' : '2px dashed rgba(255, 255, 255, 0.1)',
                borderRadius: '16px',
                padding: '30px 24px',
                textAlign: 'center',
                background: isDragging ? 'rgba(62, 137, 255, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                marginBottom: '12px',
                transition: 'all 0.2s ease',
                cursor: 'pointer'
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={{ width: '48px', height: '48px', background: 'rgba(62, 137, 255, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3e89ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </div>
              <h3 style={{ fontSize: '15px', color: '#fff', margin: '0 0 8px', fontWeight: '700' }}>
                Kéo thả file vào đây hoặc nhấn để chọn file
              </h3>
              <p style={{ fontSize: '13px', color: '#8d96aa', margin: '0 0 20px' }}>
                Hỗ trợ tải lên tối đa {MAX_FILES} file ({queue.length}/{MAX_FILES})
              </p>
              <input
                type="file"
                accept=".mp4,.mkv,.mp3"
                multiple
                style={{ display: 'none' }}
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              <button
                className="sr-button sr-button-primary"
                style={{ minHeight: '40px', height: '40px', width: 'auto', padding: '0 24px', fontSize: '13px', display: 'inline-flex', gap: '8px' }}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="12" y1="18" x2="12" y2="12"></line>
                  <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
                Chọn file
              </button>
            </div>
          )}

          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8d96aa' }}>
              <span style={{ width: '4px', height: '4px', background: '#8d96aa', borderRadius: '50%' }}></span>
              Định dạng hỗ trợ: .mp4, .mkv, .mp3 - Tối đa {MAX_FILES} file mỗi lần
            </span>
          </div>

          {/* File Queue */}
          {queue.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {queue.map((item) => {
                const isDone = item.phase === 'done';
                const isError = item.phase === 'error';
                const isQueued = item.phase === 'queued';
                const isItemUploading = item.phase === 'uploading';
                const progressColor = item.strategy === 'chunk' ? '#f59e0b' : '#00d1ff';

                let statusText = '';
                let statusColor = '#8d96aa';
                if (isQueued) { statusText = 'Đang chờ trong hàng đợi'; statusColor = '#8d96aa'; }
                else if (isItemUploading) { statusText = 'Đang tải lên'; statusColor = '#3e89ff'; }
                else if (isDone && !item.saved) { statusText = 'Hoàn thành'; statusColor = '#22c55e'; }
                else if (isDone && item.saved) { statusText = 'Đã lưu'; statusColor = '#22c55e'; }
                else if (isError) { statusText = 'Lỗi'; statusColor = '#ff5c5c'; }

                return (
                  <div key={item.id} style={{
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '12px',
                    padding: '16px',
                    background: 'rgba(255,255,255,0.02)',
                  }}>
                    {/* File info header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                        <div style={{ width: '36px', height: '36px', flexShrink: 0, background: 'rgba(62,137,255,0.1)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3e89ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                          </svg>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: '#fff', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</div>
                          <div style={{ fontSize: '12px', color: statusColor, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span>{formatBytes(item.file.size)}</span>
                            <span style={{ color: '#576176' }}>-</span>
                            <span>{statusText}</span>
                            {item.strategy && (
                              <span style={{
                                fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px',
                                padding: '2px 6px', borderRadius: '4px',
                                background: item.strategy === 'chunk' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(0, 209, 255, 0.15)',
                                color: item.strategy === 'chunk' ? '#f59e0b' : '#00d1ff',
                                border: `1px solid ${item.strategy === 'chunk' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(0, 209, 255, 0.3)'}`,
                              }}>
                                {item.strategy === 'chunk' ? 'Chunked' : 'Single'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => handleRemoveFile(item.id)} style={{ background: 'transparent', border: 'none', color: '#576176', cursor: 'pointer', padding: '4px', flexShrink: 0 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>

                    {/* Progress bar + Save button */}
                    {isError ? (
                      <>
                        <div style={{ width: '100%', height: '4px', background: 'rgba(255,62,62,0.2)', borderRadius: '99px', overflow: 'hidden', marginBottom: '8px' }}>
                          <div style={{ width: '100%', height: '100%', background: '#ff5c5c' }}></div>
                        </div>
                        <div style={{ fontSize: '11px', color: '#ff5c5c' }}>
                          <span>{item.error || 'Xử lý tải lên thất bại'}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ flex: 1, height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', overflow: 'hidden' }}>
                            <div style={{
                              width: `${item.progress}%`,
                              height: '100%',
                              background: isDone ? '#22c55e' : progressColor,
                              transition: 'width 0.15s linear'
                            }}></div>
                          </div>
                          {/* Nút Lưu - chỉ hiện khi done và chưa lưu */}
                          {isDone && !item.saved && (
                            <button
                              onClick={() => handleSaveFile(item.id)}
                              style={{
                                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                                border: 'none',
                                color: '#fff',
                                padding: '6px 16px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                flexShrink: 0,
                              }}
                            >
                              Lưu
                            </button>
                          )}
                          {/* Đã lưu */}
                          {isDone && item.saved && (
                            <span style={{ fontSize: '12px', color: '#22c55e', fontWeight: '700', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                              Đã lưu
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#576176', marginTop: '8px' }}>
                          <span>
                            {item.progress}% hoàn thành
                            {item.chunkInfo && (
                              <span style={{ marginLeft: '8px', color: '#f59e0b' }}>
                                (Chunk {item.chunkInfo.current}/{item.chunkInfo.total})
                              </span>
                            )}
                          </span>
                          <span>
                            {formatBytes(item.file.size * (item.progress / 100))} / {formatBytes(item.file.size)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Meeting name input */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#fff', marginBottom: '8px' }}>
              Đặt tên cho bản ghi (tùy chọn)
            </label>
            <div className="sr-input-wrap" style={{ minHeight: '40px' }}>
              <input
                type="text"
                placeholder="VD: Họp Marketing Quý 3 - Review chiến dịch"
                style={{ height: '38px', fontSize: '14px' }}
                value={meetingName}
                onChange={(e) => setMeetingName(e.target.value)}
              />
            </div>
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#576176' }}>
              Nếu để trống, hệ thống sẽ dùng tên file gốc làm tên bản ghi.
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              className="sr-button sr-button-secondary"
              style={{ minHeight: '36px', height: '36px', width: 'auto', padding: '0 24px', fontSize: '13px' }}
              onClick={() => {
                queue.forEach(item => {
                  if (item.abortController) item.abortController.abort();
                });
                navigate('/');
              }}
            >
              Hủy
            </button>
            <button
              className="sr-button sr-button-primary"
              style={{
                minHeight: '36px',
                height: '36px',
                width: 'auto',
                padding: '0 24px',
                fontSize: '13px',
                opacity: allSaved ? 1 : 0.5,
                cursor: allSaved ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                gap: '8px'
              }}
              disabled={!allSaved}
              onClick={() => { if (allSaved) handleStartProcessing(); }}
            >
              {allSaved ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  Bắt đầu xử lý
                </>
              ) : (
                'Đang tải lên...'
              )}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default UploadPage;
