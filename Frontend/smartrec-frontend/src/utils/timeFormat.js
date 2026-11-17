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

/**
 * Validates and normalizes a user-entered timestamp ("mm:ss", "hh:mm:ss", or seconds).
 * Returns a normalized timestamp string ("MM:SS" or "HH:MM:SS"), or null if invalid.
 */
export function normalizeTimestampInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  if (!raw.includes(':')) {
    if (!/^\d+$/.test(raw)) return null;
    return formatTimestamp(Number(raw));
  }

  const parts = raw.split(':').map((p) => p.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some((p) => !/^\d+$/.test(p))) return null;

  const nums = parts.map(Number);
  if (parts.length === 2) {
    const [minutes, seconds] = nums;
    if (seconds >= 60) return null;
    return formatTimestamp(minutes * 60 + seconds);
  }

  const [hours, minutes, seconds] = nums;
  if (minutes >= 60 || seconds >= 60) return null;
  return formatTimestamp(hours * 3600 + minutes * 60 + seconds, { forceHours: hours > 0 });
}

