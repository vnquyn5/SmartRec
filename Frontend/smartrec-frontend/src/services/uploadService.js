import { api } from "../lib/http/client.js";
import {
  calculateFullSha256,
  calculateQuickFingerprint,
} from "../utils/fileHash";

export async function checkUploadDuplicate(file, options = {}) {
  const duplicateApiStart = performance.now();
  const response = await api.post("/upload/check-duplicate", {
    fileName: file.name,
    fileSize: file.size,
    ...(options.quickFingerprint
      ? { quickFingerprint: options.quickFingerprint, fingerprintVersion: 2 }
      : {}),
    ...(options.checksumSha256 ? { checksumSha256: options.checksumSha256 } : {}),
  });

  const duplicateApiEnd = performance.now();

  if (import.meta.env.DEV) {
    console.log("[duplicate-api-response]", {
      fileName: file.name,
      fileSize: file.size,
      apiMs: Math.round(duplicateApiEnd - duplicateApiStart),
      exists: response?.exists,
      possibleDuplicate: response?.possibleDuplicate,
      requireFullChecksum: response?.requireFullChecksum,
      existingFileName: response?.existingFileName,
      mediaFileId: response?.mediaFileId,
    });
  }

  return response;
}

export async function resolveUploadDuplicate(file, options = {}) {
  const duplicateCheckStart = performance.now();
  if (import.meta.env.DEV) {
    console.log("[resolveUploadDuplicate:start]", {
      fileName: file.name,
      fileSize: file.size,
      forceFullChecksum: Boolean(options.forceFullChecksum),
    });
  }
  const fingerprintStart = performance.now();
  const quickFingerprint = await calculateQuickFingerprint(file);
  const fingerprintEnd = performance.now();
  const duplicateApiStart = performance.now();
  const quickResponse = await checkUploadDuplicate(file, {
    quickFingerprint,
    fingerprintVersion: 2,
  });
  const duplicateApiEnd = performance.now();
  if (import.meta.env.DEV) {
    console.log("[resolveUploadDuplicate:quick]", {
      fileName: file.name,
      exists: quickResponse?.exists,
      possibleDuplicate: quickResponse?.possibleDuplicate,
      requireFullChecksum: quickResponse?.requireFullChecksum,
      existingFileName: quickResponse?.existingFileName,
      mediaFileId: quickResponse?.mediaFileId,
    });
    console.log("[duplicate-performance]", {
      fileName: file.name,
      fileSize: file.size,
      quickFingerprintMs: Math.round(fingerprintEnd - fingerprintStart),
      duplicateApiMs: Math.round(duplicateApiEnd - duplicateApiStart),
      fullShaMs: 0,
      totalDuplicateCheckMs: Math.round(duplicateApiEnd - duplicateCheckStart),
    });
  }

  if (
    quickResponse?.exists ||
    (!options.forceFullChecksum ||
      (!quickResponse?.possibleDuplicate && !quickResponse?.requireFullChecksum))
  ) {
    const result = {
      ...quickResponse,
      quickFingerprint,
      fingerprintVersion: 2,
      checksumSha256: null,
    };
    if (import.meta.env.DEV) {
      console.log("[resolveUploadDuplicate:return]", {
        ...result,
        reason: quickResponse?.exists ? "quick-exact-match" : "no-candidate",
        quickFingerprintMs: Math.round(fingerprintEnd - fingerprintStart),
        duplicateApiMs: Math.round(duplicateApiEnd - duplicateApiStart),
        fullShaMs: 0,
        totalDuplicateCheckMs: Math.round(performance.now() - duplicateCheckStart),
      });
    }
    return result;
  }

  if (import.meta.env.DEV) {
    console.log("[resolveUploadDuplicate:full-sha]", {
      fileName: file.name,
      fileSize: file.size,
    });
  }
  const fullShaStart = performance.now();
  const checksumSha256 = await calculateFullSha256(file);
  const fullShaEnd = performance.now();
  const exactApiStart = performance.now();
  const exactResponse = await checkUploadDuplicate(file, {
    quickFingerprint,
    fingerprintVersion: 2,
    checksumSha256,
  });
  const exactApiEnd = performance.now();

  const result = {
    ...exactResponse,
    quickFingerprint,
    fingerprintVersion: 2,
    checksumSha256,
  };
  if (import.meta.env.DEV) {
    console.log("[duplicate-performance]", {
      fileName: file.name,
      fileSize: file.size,
      quickFingerprintMs: Math.round(fingerprintEnd - fingerprintStart),
      duplicateApiMs: Math.round(
        duplicateApiEnd - duplicateApiStart + exactApiEnd - exactApiStart,
      ),
      fullShaMs: Math.round(fullShaEnd - fullShaStart),
      totalDuplicateCheckMs: Math.round(exactApiEnd - duplicateCheckStart),
    });
    console.log("[resolveUploadDuplicate:return]", result);
  }
  return result;
}
