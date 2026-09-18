import { useCallback, useState } from 'react';
import { useSingleUpload } from './useSingleUpload.js';

/**
 * useSmartUpload – Facade Hook
 * Tạm thời bỏ logic Chunked Upload, chỉ sử dụng Single Upload cho mọi file.
 */
export function useSmartUpload() {
  const single = useSingleUpload();
  
  // Vẫn giữ lại state strategy và notification để không bị lỗi UI, nhưng luôn dùng 'single'
  const [strategy, setStrategy] = useState('single');
  const [notification, setNotification] = useState(null);

  const reset = useCallback(() => {
    single.reset();
    setStrategy('single');
    setNotification(null);
  }, [single]);

  const upload = useCallback(async (file, meetingName = '') => {
    reset();
    return single.upload(file, meetingName);
  }, [single, reset]);

  const cancel = useCallback(() => {
    single.cancel();
  }, [single]);

  const setPhase = useCallback((p) => {
    single.setPhase(p);
  }, [single]);

  return {
    upload,
    cancel,
    phase: single.phase,
    progress: single.progress,
    error: single.error,
    setPhase,
    strategy,
    notification,
    setNotification,
    reset,
    chunkInfo: null, // Không còn chunking
  };
}
