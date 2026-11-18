/**
 * Utility chuẩn hóa và tính toán thời gian cho Workspace SmartRec
 * Đảm bảo tính toán an toàn (Null-safe) và nhất quán giữa các Component
 */

/**
 * Chuyển đổi chuỗi thời gian (HH:MM:SS, MM:SS, hoặc số giây) sang số giây nguyên
 * Nếu timeStr là null, undefined, false hoặc chuỗi rỗng -> an toàn trả về 0
 * @param {string|number|null|undefined} timeStr 
 * @returns {number} Số giây an toàn >= 0
 */
export function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  if (typeof timeStr === 'number') {
    return Number.isFinite(timeStr) && timeStr > 0 ? Math.floor(timeStr) : 0;
  }
  
  try {
    const cleanStr = String(timeStr).trim();
    if (!cleanStr) return 0;

    const parts = cleanStr.split(':').map((p) => {
      const num = Number(p.trim());
      return Number.isFinite(num) ? num : 0;
    });

    if (parts.length === 3) {
      return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
    if (parts.length === 2) {
      return Math.max(0, parts[0] * 60 + parts[1]);
    }
    
    const parsed = Number(cleanStr);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

/**
 * Format số giây thành chuỗi hiển thị MM:SS hoặc HH:MM:SS
 * @param {number|string} seconds 
 * @returns {string} Chuỗi thời gian chuẩn "00:00"
 */
export function formatSecondsToTime(seconds) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return "00:00";
  
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");

  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
