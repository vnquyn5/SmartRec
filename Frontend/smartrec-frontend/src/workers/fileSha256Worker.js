import { createSHA256 } from "hash-wasm";

const HASH_CHUNK_SIZE = 8 * 1024 * 1024;

self.onmessage = async (event) => {
  const { requestId, file } = event.data || {};
  if (!requestId || !file) return;
  try {
    const hasher = await createSHA256();
    hasher.init();
    for (let start = 0; start < file.size; start += HASH_CHUNK_SIZE) {
      const end = Math.min(start + HASH_CHUNK_SIZE, file.size);
      hasher.update(new Uint8Array(await file.slice(start, end).arrayBuffer()));
    }
    self.postMessage({ requestId, checksumSha256: hasher.digest("hex") });
  } catch (error) {
    self.postMessage({ requestId, error: error?.message || "SHA-256 calculation failed." });
  }
};
