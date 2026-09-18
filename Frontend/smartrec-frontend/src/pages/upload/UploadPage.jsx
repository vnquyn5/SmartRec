import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../../components/layout/TopBar';
import { useSmartUpload } from '../../features/files/useSmartUpload.js';

const UploadPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [fileObj, setFileObj] = useState(null);
  const [meetingName, setMeetingName] = useState('');

  const { upload, cancel, phase, progress, error, setPhase, strategy, notification, setNotification, chunkInfo, reset } = useSmartUpload();

  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setFileObj(file);
      reset();

      // Tự động bắt đầu tải lên ngay khi chọn file
      try {
        await upload(file, meetingName);
      } catch (err) {
        console.error('Upload failed', err);
      }
    }
  };

  const handleRemoveFile = () => {
    if (phase === 'uploading' || phase === 'chunking' || phase === 'presigning' || phase === 'confirming') {
      cancel();
    }
    setFileObj(null);
    reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isUploading = phase === 'presigning' || phase === 'uploading' || phase === 'chunking' || phase === 'confirming';
  const isDone = phase === 'done';

  // Xác định màu progress bar dựa trên chiến lược
  const progressBarColor = strategy === 'chunk' ? '#f59e0b' : '#00d1ff';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--sr-bg)' }}>
      <TopBar />

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '24px' }}>
        <div style={{ width: '700px', maxWidth: '100%' }}>

          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#fff', marginBottom: '8px' }}>Nạp file cuộc họp</h1>
            <p style={{ fontSize: '12px', color: '#8d96aa', maxWidth: '460px', margin: '0 auto', lineHeight: '1.6' }}>
              Tải lên một file ghi âm/ghi hình đã có sẵn để hệ thống phân tích và tạo bản ghi. Đây không phải luồng tạo cuộc họp mới.
            </p>
          </div>

          {/* Thông báo chuyển sang Chunked Upload */}
          {notification && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(245, 158, 11, 0.1)',
              color: '#f59e0b',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '13px',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span style={{ fontWeight: '600' }}>{notification}</span>
            </div>
          )}

          <div style={{
            border: '1px dashed rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '30px 24px',
            textAlign: 'center',
            background: 'rgba(255, 255, 255, 0.02)',
            marginBottom: '12px'
          }}>
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
              Chỉ hỗ trợ tải lên 1 file duy nhất
            </p>

            <input
              type="file"
              accept=".mp4,.mkv,.mp3"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleFileChange}
              disabled={isUploading}
            />
            <button
              className="sr-button sr-button-primary"
              style={{ minHeight: '40px', height: '40px', width: 'auto', padding: '0 24px', fontSize: '13px', display: 'inline-flex', gap: '8px' }}
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
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

          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8d96aa' }}>
              <span style={{ width: '4px', height: '4px', background: '#8d96aa', borderRadius: '50%' }}></span>
              Định dạng hỗ trợ: .mp4, .mkv, .mp3 - Dung lượng tối đa 5GB mỗi file
            </span>
          </div>

          {error && (
            <div style={{ padding: '12px', background: 'rgba(255, 62, 62, 0.1)', color: '#ff5c5c', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', border: '1px solid rgba(255, 62, 62, 0.2)' }}>
              Lỗi: {error.message}
            </div>
          )}

          {fileObj && (
            <div style={{
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '12px',
              padding: '16px',
              background: 'rgba(255,255,255,0.02)',
              marginBottom: '24px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '36px', height: '36px', background: 'rgba(62,137,255,0.1)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3e89ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#fff', marginBottom: '4px' }}>{fileObj.name}</div>
                    <div style={{ fontSize: '12px', color: '#8d96aa', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>
                        {(() => {
                          const bytes = fileObj.size;
                          if (bytes === 0) return '0 Bytes';
                          const k = 1024;
                          const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
                          const i = Math.floor(Math.log(bytes) / Math.log(k));
                          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                        })()}
                      </span>
                      <span>-</span>
                      <span>Trạng thái: {phase}</span>
                      {/* Badge chiến lược upload */}
                      {strategy && (
                        <span style={{
                          fontSize: '10px',
                          fontWeight: '700',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: strategy === 'chunk' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(0, 209, 255, 0.15)',
                          color: strategy === 'chunk' ? '#f59e0b' : '#00d1ff',
                          border: `1px solid ${strategy === 'chunk' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(0, 209, 255, 0.3)'}`,
                        }}>
                          {strategy === 'chunk' ? 'Chunked' : 'Single'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={handleRemoveFile} style={{ background: 'transparent', border: 'none', color: '#576176', cursor: 'pointer', padding: '4px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              {/* Progress Bar Area */}
              {phase === 'error' ? (
                <>
                  <div style={{ width: '100%', height: '4px', background: 'rgba(255,62,62,0.2)', borderRadius: '99px', overflow: 'hidden', marginBottom: '8px' }}>
                    <div style={{ width: '100%', height: '100%', background: '#ff5c5c' }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#ff5c5c' }}>
                    <span>{error?.message || 'Xu ly tai len that bai'}</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', overflow: 'hidden', marginBottom: '8px' }}>
                    <div style={{ width: `${progress}%`, height: '100%', background: progressBarColor, transition: 'width 0.15s linear' }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#576176' }}>
                    <span>
                      {progress}% hoàn thành
                      {/* Hiển thị thông tin chunk nếu đang dùng Chunked Upload */}
                      {chunkInfo && (
                        <span style={{ marginLeft: '8px', color: '#f59e0b' }}>
                          (Chunk {chunkInfo.current}/{chunkInfo.total})
                        </span>
                      )}
                    </span>
                    <span>
                      {(() => {
                        const formatBytes = (bytes) => {
                          if (bytes === 0) return '0 Bytes';
                          const k = 1024;
                          const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
                          const i = Math.floor(Math.log(bytes) / Math.log(k));
                          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                        };
                        const currentBytes = fileObj.size * (progress / 100);
                        return `${formatBytes(currentBytes)} / ${formatBytes(fileObj.size)}`;
                      })()}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#fff', marginBottom: '8px' }}>
              Đặt tên cho bản ghi (tùy chọn)
            </label>
            <div className="sr-input-wrap" style={{ minHeight: '40px' }}>
              <input
                type="text"
                placeholder="VD: Họp Marketing Day 3 - Review chiến dịch"
                style={{ height: '38px', fontSize: '14px' }}
                value={meetingName}
                onChange={(e) => setMeetingName(e.target.value)}
                disabled={isUploading}
              />
            </div>
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#576176' }}>
              Nếu để trống, hệ thống sẽ dùng tên file gốc làm tên bản ghi.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              className="sr-button sr-button-secondary"
              style={{ minHeight: '36px', height: '36px', width: 'auto', padding: '0 24px', fontSize: '13px' }}
              onClick={() => {
                if (isUploading) cancel();
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
                opacity: (progress === 100) ? 1 : 0.5,
                cursor: (progress === 100) ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                gap: '8px'
              }}
              disabled={progress !== 100}
              onClick={() => {
                if (progress === 100) {
                  alert('Tạo bản ghi hoàn tất!');
                  navigate('/');
                }
              }}
            >
              {progress === 100 ? (
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
