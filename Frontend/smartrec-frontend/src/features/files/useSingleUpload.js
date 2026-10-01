import { useCallback, useRef, useState } from "react";
import { toAppError } from "../../lib/http/errors.js";
import { api, storageClient } from "../../lib/http/client.js";

export async function presignSimpleUpload(file) {
  return api.post("/upload/presign", {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
  });
}

export async function completeSimpleUpload(payload, signal) {
  return api.post("/upload/complete", payload, {
    signal,
    timeout: 0,
  });
}

export async function uploadSingleFile(
  file,
  meetingName = "",
  duplicateMetadata = null,
  signal,
  onUploadProgress,
  onFinalize,
) {
  const startedAt = Date.now();

  console.info("[simple-upload] request started", {
    fileName: file?.name,
    sizeBytes: file?.size,
    contentType: file?.type,
    startedAt: new Date(startedAt).toISOString(),
  });

  try {
    const presign = await presignSimpleUpload(file);
    console.info("[simple-upload] presign received", {
      fileName: file?.name,
      objectKey: presign.objectKey,
      expiresIn: presign.expiresIn,
    });

    await storageClient.put(presign.uploadUrl, file, {
      signal,
      onUploadProgress,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      timeout: 0,
      withCredentials: false,
    });

    const completePayload = {
      objectKey: presign.objectKey,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      title: meetingName,
      ...(duplicateMetadata?.quickFingerprint
        ? { quickFingerprint: duplicateMetadata.quickFingerprint }
        : {}),
    };

    onFinalize?.(completePayload);
    const response = await completeSimpleUpload(completePayload, signal);

    console.info("[simple-upload] request finished", {
      fileName: file?.name,
      objectKey: presign.objectKey,
      elapsedMs: Date.now() - startedAt,
    });

    return response;
  } catch (error) {
    console.error("[simple-upload] request failed", {
      fileName: file?.name,
      elapsedMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

export function useSingleUpload() {
  const [phase, setPhase] = useState("idle"); // 'idle' | 'uploading' | 'finalizing' | 'success' | 'canceled' | 'error'
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setProgress(0);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const upload = useCallback(async (file, meetingName = "") => {
    setError(null);
    setProgress(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setPhase("uploading");
      const response = await uploadSingleFile(
        file,
        meetingName,
        null,
        controller.signal,
        (event) => {
          if (event.total)
            setProgress(Math.round((event.loaded / event.total) * 100));
        },
        () => {
          setProgress(100);
          setPhase("finalizing");
        },
      );

      setProgress(100);
      setPhase("success");
      return response;
    } catch (err) {
      const appErr = err?.kind ? err : toAppError(err);
      if (appErr.kind === "canceled") {
        setProgress(0);
        setError({ ...appErr, message: "Đã huỷ" });
        setPhase("canceled");
        throw { kind: "canceled", message: "Đã huỷ" };
      }
      setError(appErr);
      setPhase("error");
      throw appErr;
    } finally {
      abortRef.current = null;
    }
  }, []);

  return { upload, cancel, phase, progress, error, setPhase, setError, reset };
}
