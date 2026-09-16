import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../../components/layout/TopBar';

const UploadPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [fileObj, setFileObj] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);

  useEffect(() => {
    if (fileObj && progress < 100) {
      // Estimate upload speed based on network connection (if available)
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      // downlink is Mbps (Megabits per second). Default to 10 Mbps if not supported.
      const mbps = connection && connection.downlink ? connection.downlink : 10; 
      
      // Convert Mbps to Bytes per second. Assume upload is ~25% of download speed.
      let uploadBps = (mbps * 1000000 / 8) * 0.25; 
      
      // Ensure at least 500 KB/s so it doesn't take forever, and max 15 MB/s
      uploadBps = Math.max(uploadBps, 500 * 1024);
      uploadBps = Math.min(uploadBps, 15 * 1024 * 1024);

      // Add a slight random jitter to simulate network fluctuation (±10%)
      const jitter = 1 + (Math.random() * 0.2 - 0.1);
      const currentSpeed = uploadBps * jitter;

      // Update every 100ms
      const bytesPerInterval = currentSpeed * 0.1;

      const timer = setInterval(() => {
        setUploadedBytes((prev) => {
          const next = prev + bytesPerInterval;
          if (next >= fileObj.size) {
            setProgress(100);
            return fileObj.size;
          }
          setProgress(Math.floor((next / fileObj.size) * 100));
          return next;
        });
      }, 100);

      return () => clearInterval(timer);
    }
  }, [fileObj, progress]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setFileObj(file);
      setFileName(file.name);
      setProgress(0);
      setUploadedBytes(0);
    }
  };

  const handleRemoveFile = () => {
    setFileName('');
    setFileObj(null);
    setProgress(0);
    setUploadedBytes(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

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
            />
            <button 
              className="sr-button sr-button-primary" 
              style={{ minHeight: '40px', height: '40px', width: 'auto', padding: '0 24px', fontSize: '13px', display: 'inline-flex', gap: '8px' }}
              onClick={() => fileInputRef.current?.click()}
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

          {fileName && (
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
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#fff', marginBottom: '4px' }}>{fileName}</div>
                    <div style={{ fontSize: '12px', color: '#8d96aa' }}>
                      {fileObj ? (fileObj.size / (1024 * 1024)).toFixed(1) : 0} MB - {progress < 100 ? 'Đang tải lên' : 'Đã tải lên'}
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
              <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: '#00d1ff', transition: 'width 0.1s linear' }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#576176' }}>
                <span>{progress}% hoàn thành</span>
                <span>
                  {fileObj ? (uploadedBytes / (1024 * 1024)).toFixed(1) : 0} MB / {fileObj ? (fileObj.size / (1024 * 1024)).toFixed(1) : 0} MB
                </span>
              </div>
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
              onClick={() => navigate('/')}
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
                opacity: (fileName && progress === 100) ? 1 : 0.5,
                cursor: (fileName && progress === 100) ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                gap: '8px'
              }}
              disabled={!fileName || progress < 100}
              onClick={() => {
                if (fileName && progress === 100) {
                  navigate('/');
                }
              }}
            >
              {fileName ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  Bắt đầu xử lý
                </>
              ) : (
                'Tiếp theo'
              )}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default UploadPage;
