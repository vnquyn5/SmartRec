import { useState, useRef, useCallback } from "react";
import { FileChunk } from "../utils/fileSlice";

interface UploadOptions { // 
  chunks: FileChunk[];
  concurrency?: number;
  maxRetries?: number;
  uploadChunkFn: (chunk: FileChunk, signal: AbortSignal) => Promise<void>;
  onSuccess?: () => void;
  onError?: (err: Error) => void;
}

export function useChunkQueue() {
  const [progress, setProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadedChunks, setUploadedChunks] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startUpload = useCallback(async ({
    chunks,
    concurrency = 3,
    maxRetries = 3,
    uploadChunkFn,
    onSuccess,
    onError,
  }: UploadOptions) => {
    setIsUploading(true);
    setProgress(0);
    setUploadedChunks(0);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    let currentIndex = 0;
    let completedCount = 0;
    const totalChunks = chunks.length;

    // Worker đơn lẻ lấy việc từ hàng đợi
    const worker = async (): Promise<void> => {
      while (currentIndex < totalChunks) {
        if (signal.aborted) throw new Error("Upload aborted");

        const chunk = chunks[currentIndex];
        currentIndex++;

        // Retry logic: thử lại tối đa maxRetries lần khi chunk upload thất bại
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await uploadChunkFn(chunk, signal);
            lastError = null;
            break; // Upload thành công, thoát vòng retry
          } catch (err: any) {
            if (signal.aborted) return;
            lastError = err;
            if (attempt < maxRetries) {
              // Chờ trước khi retry (exponential backoff: 500ms, 1000ms, 2000ms...)
              await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            }
          }
        }

        if (lastError) {
          throw lastError; // Đã retry hết số lần cho phép mà vẫn lỗi
        }

        completedCount++;
        setUploadedChunks(completedCount);
        setProgress(Math.round((completedCount / totalChunks) * 100));
      }
    };

    try {
      // Khởi chạy đồng thời số lượng worker bằng concurrency limit
      const workers = Array.from(
        { length: Math.min(concurrency, totalChunks) },
        () => worker()
      );
      await Promise.all(workers);
      setIsUploading(false);
      onSuccess?.();
    } catch (err: any) {
      setIsUploading(false);
      if (err.message !== "Upload aborted") {
        onError?.(err);
      }
    }
  }, []);

  const cancelUpload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsUploading(false);
      setProgress(0);
      setUploadedChunks(0);
    }
  }, []);

  return {
    progress,
    isUploading,
    uploadedChunks,
    startUpload,
    cancelUpload,
  };
}

