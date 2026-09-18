import { useCallback, useRef, useState } from 'react';
import { toAppError } from '../../lib/http/errors.js';



export function useSingleUpload() {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'presigning' | 'uploading' | 'confirming' | 'done' | 'error'
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setProgress(0);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const upload = useCallback(async (file, meetingName = '') => {
    setError(null); 
    setProgress(0);

    // Không còn giới hạn dung lượng ở đây nữa vì đã gộp luồng

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setPhase('uploading');
      
      // MOCK UPLOAD PROCESS (NO BACKEND)
      await new Promise((resolve, reject) => {
        let currentProgress = 0;
        const interval = setInterval(() => {
          if (controller.signal.aborted) {
            clearInterval(interval);
            reject(new Error("canceled"));
            return;
          }
          currentProgress += 10;
          if (currentProgress > 100) {
            currentProgress = 100;
          }
          setProgress(currentProgress);
          
          if (currentProgress === 100) {
            clearInterval(interval);
            setTimeout(() => resolve({ meetingId: "mock-123", url: "mock-url" }), 500);
          }
        }, 300); // 10% mỗi 300ms
      });

      setPhase('done');
      return { meetingId: "mock-123", url: "mock-url" };
    } catch (err) {
      if (err.message === 'canceled') {
        setPhase('idle');
        throw { kind: 'canceled' };
      }
      const appErr = toAppError(err);
      setError(appErr);
      setPhase('error');
      throw appErr;
    } finally {
      abortRef.current = null;
    }
  }, []);

  return { upload, cancel, phase, progress, error, setPhase, setError, reset };
}
