import { useCallback, useRef, useState } from 'react';
import { toAppError } from '../../lib/http/errors.js';

const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB mỗi chunk

export function useChunkUpload() {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'chunking' | 'uploading' | 'done' | 'error'
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [chunkInfo, setChunkInfo] = useState(null); // { current, total }

  const abortRef = useRef(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setProgress(0);
    setError(null);
    setChunkInfo(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const upload = useCallback(async (file, meetingName = '') => {
    setError(null);
    setProgress(0);

    const controller = new AbortController();
    abortRef.current = controller;

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    setChunkInfo({ current: 0, total: totalChunks });

    try {
      setPhase('chunking');

      // MOCK CHUNKED UPLOAD PROCESS (NO BACKEND)
      // Giả lập gửi từng chunk lên server
      for (let i = 0; i < totalChunks; i++) {
        if (controller.signal.aborted) {
          throw new Error('canceled');
        }

        setChunkInfo({ current: i + 1, total: totalChunks });
        setPhase('uploading');

        // Giả lập thời gian upload mỗi chunk (200-400ms)
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 300);
          controller.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('canceled'));
          }, { once: true });
        });

        // Cập nhật progress tổng thể
        const overallProgress = Math.round(((i + 1) / totalChunks) * 100);
        setProgress(overallProgress);
      }

      setPhase('done');
      return { meetingId: 'mock-chunk-456', url: 'mock-chunk-url' };
    } catch (err) {
      if (err.message === 'canceled') {
        setPhase('idle');
        setChunkInfo(null);
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

  return { upload, cancel, phase, progress, error, setPhase, chunkInfo, reset };
}
