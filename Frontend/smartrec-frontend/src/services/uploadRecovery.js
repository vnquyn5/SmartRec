import { clearInvalidHandle, getFileHandle } from "./fileHandleStorage";

export const getUploadIdentity = (file) =>
  `${file.name}-${file.size}-${file.lastModified}`;

export async function restoreFileFromHandle(item, requestPermission = false) {
  const result = await restoreChunkedFile(item, requestPermission);
  return result.file;
}

export async function restoreChunkedFile(item, requestPermission = false) {
  const recoveryKey = item.recoveryKey || item.id;
  if (import.meta.env.DEV && (item.uploadSessionId || item.recoveryKey)) {
    console.info("[chunked-recovery:restore-start]", {
      itemId: item.id,
      recoveryKey,
      uploadSessionId: item.uploadSessionId || null,
    });
  }
  let handle;
  try {
    handle = await getFileHandle(recoveryKey);
  } catch (error) {
    logChunkRestore(item, recoveryKey, false, "unavailable", false, false, error);
    return { file: null, handleFound: false, permission: "unavailable", reason: "IDB_ERROR" };
  }
  if (!handle) {
    logChunkRestore(item, recoveryKey, false, "no-handle", false, false);
    return { file: null, handleFound: false, permission: "unknown", reason: "HANDLE_NOT_FOUND" };
  }

  let permission = "unknown";
  let permissionBefore = "unknown";
  let fileRestored = false;
  let verificationPassed = false;
  try {
    permission = await handle.queryPermission({ mode: "read" });
    permissionBefore = permission;
    if (permission !== "granted" && requestPermission) {
      permission = await handle.requestPermission({ mode: "read" });
      if (import.meta.env.DEV && (item.recoveryKey || item.uploadSessionId)) {
        console.info("[chunked-recovery:permission]", {
          recoveryKey,
          before: permissionBefore,
          after: permission,
        });
      }
    }
    if (permission !== "granted") {
      logChunkRestore(item, recoveryKey, true, permission, false, false);
      return {
        file: null,
        handleFound: true,
        permission,
        reason: permission === "prompt" ? "PERMISSION_REQUIRED" : "PERMISSION_DENIED",
      };
    }

    const file = await handle.getFile();
    fileRestored = true;
    if (
      file.name !== item.fileName ||
      file.size !== item.fileSize ||
      (Number.isFinite(item.lastModified) && file.lastModified !== item.lastModified)
    ) {
      await clearInvalidHandle(recoveryKey).catch(() => {});
      logChunkRestore(item, recoveryKey, true, permission, true, false);
      return { file: null, handleFound: true, permission, reason: "FILE_MISMATCH" };
    }
    verificationPassed = true;
    logChunkRestore(item, recoveryKey, true, permission, fileRestored, verificationPassed);
    if (import.meta.env.DEV && (item.uploadSessionId || item.recoveryKey)) {
      console.info("[chunked-recovery:file-restored]", {
        recoveryKey,
        verified: true,
        fileSize: file.size,
        uploadSessionId: item.uploadSessionId || null,
      });
    }
    return { file, handleFound: true, permission, reason: null };
  } catch (error) {
    logChunkRestore(item, recoveryKey, true, permission, fileRestored, verificationPassed, error);
    return { file: null, handleFound: true, permission, reason: "RESTORE_ERROR", error };
  }
}

function logChunkRestore(item, recoveryKey, handleFound, permission, fileRestored, verificationPassed, error) {
  if (import.meta.env.DEV && (item.strategy === "chunk" || item.uploadType === "CHUNKED" || item.uploadSessionId || item.recoveryKey)) {
    console.info("[chunked-recovery:restore]", {
      itemId: item.id,
      recoveryKey,
      uploadSessionId: item.uploadSessionId || null,
      handleFound,
      permission,
      fileRestored,
      verificationPassed,
      reason: !handleFound
        ? permission === "unavailable" ? "IDB_ERROR" : "HANDLE_NOT_FOUND"
        : permission === "prompt"
          ? "PERMISSION_REQUIRED"
          : permission === "denied"
            ? "PERMISSION_DENIED"
            : fileRestored && !verificationPassed
              ? "FILE_MISMATCH"
              : undefined,
      ...(error ? { error: error.message || String(error) } : {}),
    });
  }
}

export async function restoreAvailableFiles(items, attachFile) {
  await Promise.all(items.map(async (item) => {
    if (item.hasFile === false && !["success", "canceled"].includes(item.phase)) {
      const file = await restoreFileFromHandle(item);
      if (file) attachFile(item.id, file);
    }
  }));
}

export async function restoreAvailableChunkFiles(items, { attachFile, markPermissionRequired, markUnavailable }) {
  await Promise.all(items.map(async (item) => {
    if (item.hasFile || ["success", "canceled", "ready_to_merge", "merging"].includes(item.phase)) return;
    const result = await restoreChunkedFile(item);
    if (result.file) attachFile(item.id, result.file);
    else if (result.reason === "PERMISSION_REQUIRED") markPermissionRequired(item.id, true);
    else markUnavailable(item.id, result.reason);
  }));
}

export async function pickFilesWithPersistentHandles() {
  if (typeof window.showOpenFilePicker !== "function") return null;
  try {
    const handles = await window.showOpenFilePicker({ multiple: true });
    return await Promise.all(handles.map(async (handle) => ({
      file: await handle.getFile(),
      handle,
    })));
  } catch (error) {
    if (error?.name === "AbortError") return [];
    return null;
  }
}
