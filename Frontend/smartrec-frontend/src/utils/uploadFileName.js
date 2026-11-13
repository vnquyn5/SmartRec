const SUPPORTED_EXTENSIONS = new Set([".mp3", ".mp4", ".m4a", ".mkv"]);
const MAX_FILE_NAME_LENGTH = 500;

export function splitUploadFileName(fileName = "") {
  const name = String(fileName);
  const dotIndex = name.lastIndexOf(".");

  if (dotIndex === 0 && SUPPORTED_EXTENSIONS.has(name.toLowerCase())) {
    return { baseName: "", extension: name };
  }

  if (dotIndex > 0) {
    return {
      baseName: name.slice(0, dotIndex),
      extension: name.slice(dotIndex),
    };
  }

  return { baseName: name, extension: "" };
}

export function getUploadFileNameDraft(item) {
  const sourceFileName = item?.sourceFileName || item?.file?.name || item?.fileName || "";
  const storedFileName = item?.fileName || sourceFileName;
  const sourceParts = splitUploadFileName(sourceFileName);

  if (!sourceParts.extension) {
    return { baseName: storedFileName, extension: "" };
  }

  const storedLower = storedFileName.toLowerCase();
  const extensionLower = sourceParts.extension.toLowerCase();
  if (
    storedFileName !== sourceParts.extension &&
    storedLower.endsWith(extensionLower)
  ) {
    return {
      baseName: storedFileName.slice(0, -sourceParts.extension.length),
      extension: sourceParts.extension,
    };
  }

  return sourceParts;
}

export function normalizeUploadFileName(baseName, extension) {
  const trimmedBaseName = String(baseName ?? "").trim();
  if (!trimmedBaseName) return null;

  // A rename is a single filename, never a path. Preserve Unicode and interior
  // whitespace so the displayed name is the name sent to the existing API.
  if (/[\\/\u0000-\u001f\u007f]/.test(trimmedBaseName)) return null;
  if (trimmedBaseName === "." || trimmedBaseName === "..") return null;

  const currentExtension = String(extension ?? "");
  const withoutDuplicateExtension =
    currentExtension &&
    trimmedBaseName.toLowerCase().endsWith(currentExtension.toLowerCase())
      ? trimmedBaseName.slice(0, -currentExtension.length).trimEnd()
      : trimmedBaseName;
  if (!withoutDuplicateExtension) return null;

  const maxBaseLength = Math.max(
    0,
    MAX_FILE_NAME_LENGTH - Array.from(currentExtension).length,
  );
  const normalizedBaseName = Array.from(withoutDuplicateExtension)
    .slice(0, maxBaseLength)
    .join("");

  if (!normalizedBaseName.trim()) return null;
  return `${normalizedBaseName}${currentExtension}`;
}
