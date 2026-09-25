import { useState, useRef, useCallback } from "react";

interface SimpleUploadOptions {
  file: File;
  uploadUrl: string;
  onSuccess?: () => void;
  onError?: (err: Error) => void;
}

export function useSimpleUpload() {
  const [progress, setProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadedBytes, setUploadedBytes] = useState<number>(0);
  const [speedBps, setSpeedBps] = useState<number>(0);
  
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastLoadedRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const startUpload = useCallback(async ({
    file,
    uploadUrl,
    onSuccess,
    onError,
  }: SimpleUploadOptions) => {
    setIsUploading(true);
    setProgress(0);
    setUploadedBytes(0);
    setSpeedBps(0);

    startTimeRef.current = Date.now();
    lastLoadedRef.current = 0;
    lastTimeRef.current = startTimeRef.current;

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percentComplete = Math.round((e.loaded / e.total) * 100);
        setProgress(percentComplete);
        setUploadedBytes(e.loaded);

        const now = Date.now();
        const timeDiff = (now - lastTimeRef.current) / 1000; // seconds
        if (timeDiff > 0.5) { // Update speed every 500ms
          const bytesDiff = e.loaded - lastLoadedRef.current;
          setSpeedBps(bytesDiff / timeDiff);
          lastTimeRef.current = now;
          lastLoadedRef.current = e.loaded;
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setIsUploading(false);
        setProgress(100);
        onSuccess?.();
      } else {
        setIsUploading(false);
        onError?.(new Error(`Upload failed with status: ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      onError?.(new Error("Network Error"));
    };

    xhr.onabort = () => {
      setIsUploading(false);
    };

    // Giả lập gửi lên API (vì đang code Frontend giả lập)
    // Thực tế sẽ là: xhr.open("POST", uploadUrl); formData... xhr.send(formData);
    // Để có thể demo UI chạy thanh progress, chúng ta sẽ mô phỏng xhr behavior:
    let loaded = 0;
    const total = file.size;
    const interval = setInterval(() => {
      if (xhr.readyState === XMLHttpRequest.UNSENT) {
        // Giả lập tốc độ khoảng 20-50MB/s
        const chunk = Math.random() * 20 * 1024 * 1024 + 10 * 1024 * 1024; 
        loaded = Math.min(loaded + chunk, total);
        
        // Trigger event (fix context error)
        if (xhr.upload.onprogress) {
          const onProgress = xhr.upload.onprogress as Function;
          onProgress({ lengthComputable: true, loaded, total });
        }

        if (loaded >= total) {
          clearInterval(interval);
          (xhr as any).status = 200; // fix readonly error
          if (xhr.onload) {
            xhr.onload({} as ProgressEvent);
          }
        }
      } else {
        clearInterval(interval); // Đã bị abort
      }
    }, 500);

    // Lưu function clear vào abort để giả lập cancel
    xhr.abort = () => {
      (xhr as any).readyState = XMLHttpRequest.DONE; // fix readonly error
      clearInterval(interval);
      if (xhr.onabort) {
        xhr.onabort({} as ProgressEvent);
      }
    };
  }, []);

  const cancelUpload = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      setIsUploading(false);
      setProgress(0);
      setUploadedBytes(0);
      setSpeedBps(0);
    }
  }, []);

  return {
    progress,
    isUploading,
    uploadedBytes,
    speedBps,
    startUpload,
    cancelUpload,
  };
}

