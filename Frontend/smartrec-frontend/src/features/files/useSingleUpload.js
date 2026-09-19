import { useCallback, useRef, useState } from 'react';
import { toAppError } from '../../lib/http/errors.js';
import { api } from '../../lib/http/client.js';

export async function uploadSingleFile(file, meetingName = '', signal, onUploadProgress) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', meetingName);

  return api.post('/meetings/upload', formData, {
    signal,
    onUploadProgress,
  });
}


export function useSingleUpload() {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'uploading' | 'success' | 'error'
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

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setPhase('uploading');
      const response = await uploadSingleFile(
        file,
        meetingName,
        controller.signal,
        (event) => {
          if (event.total) setProgress(Math.round((event.loaded / event.total) * 100));
        },
      );

      setProgress(100);
      setPhase('success');
      return response;
    } catch (err) {
      if (err.kind === 'canceled' || err.message === 'canceled') {
        setPhase('idle');
        throw { kind: 'canceled' };
      }
      const appErr = err?.kind ? err : toAppError(err);
      setError(appErr);
      setPhase('error');
      throw appErr;
    } finally {
      abortRef.current = null;
    }
  }, []);

  return { upload, cancel, phase, progress, error, setPhase, setError, reset };
}
