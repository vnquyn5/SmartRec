export interface FileChunk {
  index: number;
  start: number;
  end: number;
  size: number;
}

export const CHUNK_SIZE_5MB = 5 * 1024 * 1024; // 5MB
export const LIMIT_2GB = 2 * 1024 * 1024 * 1024; // 2GB
export const LIMIT_5GB = 5 * 1024 * 1024 * 1024; // 5GB
export const LIMIT_4_HOURS_SEC = 4 * 60 * 60; // 4 Giờ

/**
 * Tính toán danh sách Chunk của file lớn (chỉ metadata, không load vào RAM)
 */
export function sliceFileToBlobs(
  file: File,
  chunkSize: number = CHUNK_SIZE_5MB
): FileChunk[] {
  const chunks: FileChunk[] = [];
  const totalSize = file.size;
  let start = 0;
  let index = 0;

  while (start < totalSize) {
    const end = Math.min(start + chunkSize, totalSize);
    chunks.push({
      index,
      start,
      end,
      size: end - start,
    });
    start = end;
    index++;
  }

  return chunks;
}

/**
 * Format bytes hiển thị chuẩn B, KB, MB, GB
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Lấy thời lượng (duration) của file Audio/Video
 */
export function getMediaDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const isVideo = file.type.startsWith("video/");
    const media = isVideo ? document.createElement("video") : document.createElement("audio");
    
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      URL.revokeObjectURL(media.src);
      resolve(media.duration);
    };
    media.onerror = () => {
      URL.revokeObjectURL(media.src);
      resolve(0); // Nếu lỗi không đọc được, bypass
    };
    
    media.src = URL.createObjectURL(file);
  });
}

/**
 * Format thời gian giây -> HH:mm:ss hoặc mm:ss
 */
export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const pad = (num: number) => num.toString().padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
