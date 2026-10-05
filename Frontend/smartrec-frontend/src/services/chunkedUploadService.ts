import SparkMD5 from "spark-md5";
import { api } from "../lib/http/client.js";

const MERGE_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export interface InitUploadPayload {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  quickFingerprint?: string | null;
}

export interface InitUploadResponse {
  uploadSessionId: string;
  chunkSize: number;
  totalChunks: number;
  status: string;
}

export interface UploadChunkPayload {
  uploadSessionId: string;
  chunkIndex: number;
  blob: Blob;
  signal?: AbortSignal;
}

export interface MergeUploadResponse {
  uploadSessionId: string;
  fileName: string;
  fileUrl: string;
  status: string;
}

export interface UploadSessionStatusResponse {
  uploadSessionId: string;
  status: string;
  receivedChunks: number;
  totalChunks: number;
  missingChunks?: number[];
}

export async function initChunkedUpload(
  payload: InitUploadPayload,
): Promise<InitUploadResponse> {
  if (import.meta.env.DEV) {
    console.log("[chunked-upload:init-request]", payload);
  }
  return api.post("/upload/init", payload);
}

async function calculateMD5(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(buffer);
  return spark.end();
}

export async function uploadChunk({
  uploadSessionId,
  chunkIndex,
  blob,
  signal,
}: UploadChunkPayload) {
  const formData = new FormData();
  formData.append("uploadSessionId", uploadSessionId);
  formData.append("chunkIndex", String(chunkIndex));
  formData.append("checksumMD5", await calculateMD5(blob));
  formData.append("file", blob, `chunk_${chunkIndex}`);

  return api.post("/upload/chunk", formData, {
    signal,
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 0,
  });
}

export async function mergeChunkedUpload(
  uploadSessionId: string,
  fileName?: string,
): Promise<MergeUploadResponse> {
  const startedAt = Date.now();
  console.info("[chunked-upload] merge started", {
    uploadSessionId,
    fileName,
    startedAt: new Date(startedAt).toISOString(),
    timeoutMs: MERGE_UPLOAD_TIMEOUT_MS,
  });

  try {
    const response = await api.post(
      "/upload/merge",
      {
        uploadSessionId,
        ...(fileName ? { fileName } : {}),
      },
      {
        timeout: MERGE_UPLOAD_TIMEOUT_MS,
      },
    );

    console.info("[chunked-upload] merge success", {
      uploadSessionId,
      elapsedMs: Date.now() - startedAt,
      response,
    });

    return response;
  } catch (error) {
    const appError = error as {
      code?: string;
      kind?: string;
      message?: string;
      status?: number;
      response?: { status?: number };
    };
    console.error("[chunked-upload] merge error", {
      uploadSessionId,
      elapsedMs: Date.now() - startedAt,
      kind: appError.kind,
      code: appError.code,
      message: appError.message,
      status: appError.status,
      responseStatus: appError.response?.status,
      error,
    });
    throw error;
  }
}

export async function getChunkedUploadStatus(
  uploadSessionId: string,
): Promise<UploadSessionStatusResponse> {
  return api.get("/upload/status", {
    params: { uploadSessionId },
    timeout: 15000,
  });
}

export async function pauseChunkedUpload(uploadSessionId: string) {
  return api.post("/upload/pause", null, {
    params: { uploadSessionId },
  });
}

export async function resumeChunkedUpload(uploadSessionId: string) {
  return api.post("/upload/resume", null, {
    params: { uploadSessionId },
  });
}

export async function cancelChunkedUpload(uploadSessionId: string) {
  return api.post("/upload/cancel", null, {
    params: { uploadSessionId },
  });
}
