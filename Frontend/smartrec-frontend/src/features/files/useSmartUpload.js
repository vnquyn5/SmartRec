import { useCallback, useState } from 'react';
import { useSingleUpload } from './useSingleUpload.js';
import { useChunkUpload } from './useChunkUpload.js';

// Ngưỡng chuyển đổi giữa Single Upload và Chunked Upload
const CHUNK_THRESHOLD = 2 * 1024 * 1024 * 1024; // 2GB

/**
 * useSmartUpload – Facade Hook
 * Tự động quyết định chiến lược upload dựa trên kích thước file:
 *   - file <= 2GB  → Single Upload (gửi nguyên file)
 *   - file > 2GB   → Chunked Upload (chia nhỏ file)
 */
export function useSmartUpload() {
  const single = useSingleUpload();
  const chunk = useChunkUpload();

  // 'single' | 'chunk' | null
  const [strategy, setStrategy] = useState(null);
  // Thông báo khi chuyển sang chunked
  const [notification, setNotification] = useState(null);

  // Chọn bộ state active dựa trên strategy hiện tại
  const active = strategy === 'chunk' ? chunk : single;

  const reset = useCallback(() => { // hàm reset upload và state callback
    single.reset(); // reset lại trạng thái single
    chunk.reset(); // reset lại trạng thái chunk
    setStrategy(null); // reset lại chiến lược
    setNotification(null); // reset lại thông báo
  }, [single, chunk]); // callback function

  const upload = useCallback(async (file, meetingName = '') => { // hàm upload file callback function
    reset();

    // Quyết định chiến lược dựa trên kích thước file
    if (file.size > CHUNK_THRESHOLD) { // nếu file lớn hơn ngưỡng
      setStrategy('chunk'); // sử dụng chunk upload
      setNotification('File vượt quá 2GB, chuyển sang quá trình chunked File và Upload'); // thông báo
      return chunk.upload(file, meetingName); // sử dụng chunk upload
    } else { // nếu file nhỏ hơn ngưỡng
      setStrategy('single'); // sử dụng single upload
      return single.upload(file, meetingName); // sử dụng single upload
    }
  }, [single, chunk, reset]); // callback function

  const cancel = useCallback(() => { // hàm cancel upload callback function
    active.cancel(); // cancel upload
  }, [active]); // callback function

  const setPhase = useCallback((p) => { // hàm setPhase callback function
    active.setPhase(p); // set trạng thái upload
  }, [active]); // callback function

  return { // return các hàm và state
    upload, // hàm upload
    cancel, // hàm cancel
    phase: active.phase, // trạng thái upload
    progress: active.progress, // tiến độ upload
    error: active.error, // lỗi upload
    setPhase, // hàm setPhase
    strategy, // chiến lược upload
    notification, // thông báo
    setNotification, // hàm setNotification
    reset, // hàm reset
    // Thông tin chunk (chỉ có khi strategy === 'chunk')
    chunkInfo: strategy === 'chunk' ? chunk.chunkInfo : null, // thông tin chunk (chỉ có khi strategy === 'chunk')
  };
}
