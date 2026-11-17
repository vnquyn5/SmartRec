/**
 * Converts a timestamp string ("mm:ss" or "hh:mm:ss") or numeric value into seconds.
 * Returns 0 for invalid or empty inputs.
 */
export function parseTimeToSeconds(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  const raw = String(value).trim();
  if (!raw) return 0;

  if (!raw.includes(':')) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  const parts = raw.split(':').map((part) => {
    const n = Number(part.trim());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Formats a duration in seconds into "MM:SS" or "HH:MM:SS".
 */
export function formatTimestamp(value, { forceHours = false } = {}) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (forceHours || hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

