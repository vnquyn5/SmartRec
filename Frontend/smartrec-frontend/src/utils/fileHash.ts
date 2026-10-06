const QUICK_BLOCK_SIZE = 2 * 1024 * 1024;
const quickFingerprintCache = new Map<string, Promise<string>>();

async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return arrayBufferToHex(digest);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export async function calculateQuickFingerprint(file: File): Promise<string> {
  const cacheKey = `${file.name}-${file.size}-${file.lastModified}`;
  const cached = quickFingerprintCache.get(cacheKey);
  if (cached) {
    if (import.meta.env.DEV) {
      console.log("[quick-fingerprint:cache-hit]", {
        fileName: file.name,
        fileSize: file.size,
      });
    }
    return cached;
  }

  const promise = calculateQuickFingerprintUncached(file);
  quickFingerprintCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    quickFingerprintCache.delete(cacheKey);
    throw error;
  }
}

async function calculateQuickFingerprintUncached(file: File): Promise<string> {
  const ranges = buildQuickFingerprintRanges(file.size);
  const totalBytesRead =
    rangeSize(ranges.first) + rangeSize(ranges.middle) + rangeSize(ranges.last);

  if (import.meta.env.DEV) {
    console.log("[quick-fingerprint:ranges]", {
      fileName: file.name,
      fileSize: file.size,
      first: ranges.first,
      middle: ranges.middle,
      last: ranges.last,
      totalBytesRead,
    });
  }

  const [firstHash, middleHash, lastHash] = await Promise.all([
    hashFileRange(file, ranges.first),
    hashFileRange(file, ranges.middle),
    hashFileRange(file, ranges.last),
  ]);

  const canonical = `${file.size}:${firstHash}:${middleHash}:${lastHash}`;
  return sha256ArrayBuffer(new TextEncoder().encode(canonical));
}

function rangeSize(range: { start: number; end: number }) {
  return Math.max(range.end - range.start, 0);
}

function buildQuickFingerprintRanges(fileSize: number) {
  if (fileSize <= QUICK_BLOCK_SIZE) {
    const wholeFile = { start: 0, end: fileSize };
    return {
      first: wholeFile,
      middle: wholeFile,
      last: wholeFile,
    };
  }

  if (fileSize < QUICK_BLOCK_SIZE * 3) {
    const firstEnd = Math.ceil(fileSize / 3);
    const middleEnd = Math.ceil((fileSize * 2) / 3);
    return {
      first: { start: 0, end: firstEnd },
      middle: { start: firstEnd, end: middleEnd },
      last: { start: middleEnd, end: fileSize },
    };
  }

  const middleStart = Math.floor((fileSize - QUICK_BLOCK_SIZE) / 2);
  return {
    first: { start: 0, end: QUICK_BLOCK_SIZE },
    middle: { start: middleStart, end: middleStart + QUICK_BLOCK_SIZE },
    last: { start: fileSize - QUICK_BLOCK_SIZE, end: fileSize },
  };
}

async function hashFileRange(
  file: File,
  range: { start: number; end: number },
): Promise<string> {
  return sha256ArrayBuffer(await readBlob(file.slice(range.start, range.end)));
}

export async function calculateFullSha256(file: File): Promise<string> {
  return calculateFullSha256InWorker(file);
}

export function calculateFullSha256InWorker(
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error("Web Worker không khả dụng để tính SHA-256."));
  }
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const worker = new Worker(
      new URL("../workers/fileSha256Worker.js", import.meta.url),
      { type: "module" },
    );
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Hashing canceled", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event) => {
      if (event.data?.requestId !== requestId) return;
      if (!event.data.checksumSha256 && !event.data.error) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else {
        if (import.meta.env.DEV) {
          console.info("[file-sha256-worker] completed", {
            fileName: file.name,
            fileSize: file.size,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        }
        resolve(event.data.checksumSha256);
      }
    };
    worker.onerror = (event) => {
      cleanup();
      reject(event.error || new Error(event.message || "SHA-256 worker failed."));
    };
    worker.postMessage({ requestId, file });
  });
}
