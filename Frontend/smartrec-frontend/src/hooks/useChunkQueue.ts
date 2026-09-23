import { useState, useRef, useCallback } from "react";
import { FileChunk } from "../utils/fileSlice";

import SparkMD5 from "spark-md5";

export interface ChunkUploadData {
  chunkIndex: number;
  checksumMD5: string;
  blob: Blob;
  uploadSessionId?: string;
}

interface UploadOptions {
  file: File;
  chunks: FileChunk[];
  uploadSessionId?: string;
  concurrency?: number;
  maxRetries?: number;
  uploadChunkFn: (data: ChunkUploadData, signal: AbortSignal) => Promise<void>;
  onSuccess?: () => void;
  onError?: (err: Error) => void;
}

export function useChunkQueue() {
  const [progress, setProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [uploadedChunks, setUploadedChunks] = useState<number>(0);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [speedBps, setSpeedBps] = useState<number>(0);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentIndexRef = useRef<number>(0);
  const completedCountRef = useRef<number>(0);
  const activeWorkersRef = useRef<number>(0);
  const isPausedRef = useRef<boolean>(false);
  
  const chunksRef = useRef<FileChunk[]>([]);
  const optionsRef = useRef<UploadOptions | null>(null);
  
  // Phục vụ tính Speed - dùng totalBytesUploaded để chính xác hơn
  const lastSpeedTimeRef = useRef<number>(0);
  const lastSpeedBytesRef = useRef<number>(0);
  const totalBytesUploadedRef = useRef<number>(0);

  const processQueue = useCallback(() => {
    if (!optionsRef.current || isPausedRef.current) return;
    
    const { chunks, maxRetries = 3, uploadChunkFn, onSuccess, onError } = optionsRef.current;
    const totalChunks = chunks.length;

    const worker = async (): Promise<void> => {
      activeWorkersRef.current++;
      while (currentIndexRef.current < totalChunks && !isPausedRef.current) {
        // Lấy chunk từ queue
        const index = currentIndexRef.current;
        currentIndexRef.current++;
        if (index >= totalChunks) break;
        const chunk = chunks[index];

        // JIT slice - chỉ cắt khi cần
        const blob = optionsRef.current!.file.slice(chunk.start, chunk.end, optionsRef.current!.file.type);
        
        // Chỉ tính MD5 khi có uploadSessionId (kết nối thực tế với backend)
        let checksumMD5 = "";
        if (optionsRef.current?.uploadSessionId) {
          try {
            const buffer = await blob.arrayBuffer();
            const spark = new SparkMD5.ArrayBuffer();
            spark.append(buffer);
            checksumMD5 = spark.end();
          } catch (e) {
            console.error("Error generating MD5", e);
          }
        }

        const chunkData: ChunkUploadData = {
          chunkIndex: chunk.index,
          checksumMD5,
          blob,
          uploadSessionId: optionsRef.current?.uploadSessionId,
        };

        if (abortControllerRef.current?.signal.aborted) {
          activeWorkersRef.current--;
          return;
        }

        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            if (abortControllerRef.current?.signal.aborted || isPausedRef.current) break;
            
            await uploadChunkFn(chunkData, abortControllerRef.current!.signal);
            lastError = null;
            break; 
          } catch (err: any) {
            if (abortControllerRef.current?.signal.aborted || isPausedRef.current) break;
            lastError = err;
            setRetryCount(prev => prev + 1);
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            }
          }
        }

        if (lastError && !abortControllerRef.current?.signal.aborted && !isPausedRef.current) {
          abortControllerRef.current?.abort();
          setIsUploading(false);
          onError?.(lastError);
          activeWorkersRef.current--;
          return;
        }

        if (!abortControllerRef.current?.signal.aborted && !isPausedRef.current) {
          completedCountRef.current++;
          totalBytesUploadedRef.current += chunk.size;
          setUploadedChunks(completedCountRef.current);
          setProgress(Math.round((completedCountRef.current / totalChunks) * 100));

          // Tính tốc độ dựa trên bytes thực tế đã upload
          const now = Date.now();
          const timeDiff = (now - lastSpeedTimeRef.current) / 1000;
          if (timeDiff >= 1) {
            const bytesDiff = totalBytesUploadedRef.current - lastSpeedBytesRef.current;
            if (bytesDiff > 0) {
              setSpeedBps(bytesDiff / timeDiff);
            }
            lastSpeedTimeRef.current = now;
            lastSpeedBytesRef.current = totalBytesUploadedRef.current;
          }
        }
      }
      activeWorkersRef.current--;

      if (completedCountRef.current === totalChunks && !isPausedRef.current) {
        setIsUploading(false);
        setSpeedBps(0);
        onSuccess?.();
      }
    };

    const concurrency = optionsRef.current.concurrency || 3;
    const workersToStart = Math.min(
      concurrency - activeWorkersRef.current,
      totalChunks - currentIndexRef.current
    );

    for (let i = 0; i < workersToStart; i++) {
      worker();
    }
  }, []);

  const startUpload = useCallback((options: UploadOptions) => {
    optionsRef.current = options;
    chunksRef.current = options.chunks;
    
    setIsUploading(true);
    setIsPaused(false);
    isPausedRef.current = false;
    setProgress(0);
    setUploadedChunks(0);
    setRetryCount(0);
    setSpeedBps(0);
    
    currentIndexRef.current = 0;
    completedCountRef.current = 0;
    activeWorkersRef.current = 0;
    totalBytesUploadedRef.current = 0;
    
    lastSpeedTimeRef.current = Date.now();
    lastSpeedBytesRef.current = 0;

    abortControllerRef.current = new AbortController();
    processQueue();
  }, [processQueue]);

  const pauseUpload = useCallback(() => {
    isPausedRef.current = true;
    setIsPaused(true);
    setIsUploading(false);
    setSpeedBps(0);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    currentIndexRef.current = completedCountRef.current;
  }, []);

  const resumeUpload = useCallback(() => {
    isPausedRef.current = false;
    setIsPaused(false);
    setIsUploading(true);
    lastSpeedTimeRef.current = Date.now();
    lastSpeedBytesRef.current = totalBytesUploadedRef.current;
    abortControllerRef.current = new AbortController();
    processQueue();
  }, [processQueue]);

  const cancelUpload = useCallback(() => {
    isPausedRef.current = false;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsUploading(false);
    setIsPaused(false);
    setProgress(0);
    setUploadedChunks(0);
    setRetryCount(0);
    setSpeedBps(0);
    currentIndexRef.current = 0;
    completedCountRef.current = 0;
    totalBytesUploadedRef.current = 0;
  }, []);

  return {
    progress,
    isUploading,
    isPaused,
    uploadedChunks,
    retryCount,
    speedBps,
    startUpload,
    pauseUpload,
    resumeUpload,
    cancelUpload,
  };
}
