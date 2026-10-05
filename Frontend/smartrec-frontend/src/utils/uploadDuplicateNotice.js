import { resolveUploadDuplicate } from "../services/uploadService";

export const buildUploadDuplicateNotice = (existingNames, totalSelectedCount) => {
  if (import.meta.env.DEV) {
    console.log("[duplicate-notice:input]", {
      existingNames,
      totalSelectedCount,
    });
  }
  let notice;
  if (existingNames.length === totalSelectedCount) {
    notice = {
      title: "Tất cả file đã chọn đã có trong hệ thống.",
      names: existingNames,
    };
  } else if (existingNames.length === 1) {
    notice = {
      title: `File đã có trong hệ thống: ${existingNames[0]}`,
      names: [],
    };
  } else {
    notice = {
      title: "Một số file đã chọn đã có trong hệ thống:",
      names: existingNames,
    };
  }

  if (import.meta.env.DEV) {
    console.log("[duplicate-notice:output]", notice);
  }
  return notice;
};

export async function checkFilesForUploadDuplicates(
  files,
  { getIdentity, forceFullChecksum = () => false },
) {
  if (files.length === 0) {
    return {
      duplicatesByIdentity: new Map(),
      metadataByIdentity: new Map(),
      duplicateItems: [],
      uploadableFiles: [],
    };
  }

  const results = await Promise.all(
    files.map(async (file) => {
      const shouldForceFullChecksum = forceFullChecksum(file);
      if (import.meta.env.DEV) {
        console.log("[duplicate-helper:start-file]", {
          fileName: file.name,
          fileSize: file.size,
          forceFullChecksum: shouldForceFullChecksum,
        });
      }

      const response = await resolveUploadDuplicate(file, {
        forceFullChecksum: shouldForceFullChecksum,
      });

      if (import.meta.env.DEV) {
        console.log("[duplicate-helper:file]", {
          fileName: file.name,
          fileSize: file.size,
          result: response,
        });
      }

      return [getIdentity(file), file, response];
    }),
  );

  const duplicatesByIdentity = new Map();
  const metadataByIdentity = new Map();
  const duplicateItems = [];
  const uploadableFiles = [];

  results.forEach(([identity, file, response]) => {
    metadataByIdentity.set(identity, {
      quickFingerprint: response?.quickFingerprint || null,
      checksumSha256: response?.checksumSha256 || null,
    });

    if (response?.exists) {
      const duplicate = {
        mediaFileId: response.mediaFileId,
        existingFileName: response.existingFileName || "File không tên",
        fileSize: response.fileSize,
        objectKey: response.objectKey,
      };
      duplicatesByIdentity.set(identity, duplicate);
      duplicateItems.push({ file, duplicate });
      if (import.meta.env.DEV) {
        console.log("[duplicate-helper:classified]", {
          fileName: file.name,
          fileSize: file.size,
          classification: "duplicate",
          existingFileName: duplicate.existingFileName,
          mediaFileId: duplicate.mediaFileId,
        });
      }
      return;
    }

    uploadableFiles.push(file);
    if (import.meta.env.DEV) {
      console.log("[duplicate-helper:classified]", {
        fileName: file.name,
        fileSize: file.size,
        classification: "uploadable",
      });
    }
  });

  if (import.meta.env.DEV) {
    console.log("[duplicate-helper:summary]", {
      duplicates: duplicateItems,
      uploadableFiles,
    });
  }

  return {
    duplicatesByIdentity,
    metadataByIdentity,
    duplicateItems,
    uploadableFiles,
  };
}
