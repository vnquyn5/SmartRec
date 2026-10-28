export const MEDIA_UPLOAD_ACCEPT = ".mp4,.mkv,.mp3,.m4a";

const MEDIA_TYPES_BY_EXTENSION = {
  mp4: ["video/mp4", "application/mp4"],
  mkv: ["video/x-matroska", "video/matroska", "application/x-matroska"],
  mp3: ["audio/mpeg", "audio/mp3", "audio/x-mpeg", "audio/x-mp3"],
  m4a: ["audio/mp4", "audio/m4a", "audio/x-m4a"],
};

export function getMediaUploadError(file) {
  const extension = file?.name?.split(".").pop()?.toLowerCase() || "";
  const allowedTypes = MEDIA_TYPES_BY_EXTENSION[extension];
  if (!allowedTypes) {
    return "Chỉ hỗ trợ tệp MP4, MKV, MP3 hoặc M4A.";
  }

  const mimeType = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (mimeType && mimeType !== "application/octet-stream" && !allowedTypes.includes(mimeType)) {
    return `MIME type ${mimeType} không khớp với phần mở rộng .${extension}.`;
  }

  return null;
}
