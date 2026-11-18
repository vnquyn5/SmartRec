import { api as httpClient } from '../lib/http/client.js';

const STORAGE_PREFIX = 'smartrec.review.v1';

function buildKey(scope, meetingId) {
  const safeId = meetingId ? String(meetingId).trim() : 'default';
  return `${STORAGE_PREFIX}.${scope}.${safeId || 'default'}`;
}

function readStorageJson(key, fallback) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorageJson(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether custom task edits are stored for a meeting.
 */
export function hasSavedMeetingTasks(meetingId) {
  const saved = readStorageJson(buildKey('tasks', meetingId), null);
  return Array.isArray(saved);
}

/**
 * Loads saved tasks for a meeting, falling back to default/mock tasks.
 */
export function loadMeetingTasks(meetingId, fallbackTasks = []) {
  const saved = readStorageJson(buildKey('tasks', meetingId), null);
  return Array.isArray(saved) ? saved : fallbackTasks;
}

/**
 * Persists edited task matrix rows for a meeting.
 * Designed as an async adapter so a backend PUT endpoint can replace localStorage later.
 */
export async function saveMeetingTasks(meetingId, tasks) {
  const normalized = Array.isArray(tasks) ? tasks : [];
  writeStorageJson(buildKey('tasks', meetingId), normalized);
  return normalized;
}

/**
 * Clears saved task overrides for a meeting so it reverts to original AI tasks.
 */
export function resetMeetingTasks(meetingId) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.removeItem(buildKey('tasks', meetingId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads edited transcript segment text overrides keyed by chunkKey.
 */
export function loadTranscriptOverrides(meetingId) {
  const saved = readStorageJson(buildKey('transcript_overrides', meetingId), {});
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

/**
 * Persists transcript segment text overrides keyed by chunkKey.
 */
export async function saveTranscriptOverrides(meetingId, overridesMap) {
  const safeMap =
    overridesMap && typeof overridesMap === 'object' && !Array.isArray(overridesMap)
      ? overridesMap
      : {};
  writeStorageJson(buildKey('transcript_overrides', meetingId), safeMap);
  return safeMap;
}

/**
 * Clears all saved transcript text overrides for a meeting.
 */
export function resetTranscriptOverrides(meetingId) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.removeItem(buildKey('transcript_overrides', meetingId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads local speaker display name overrides keyed by speakerId/originalLabel.
 */
export function loadSpeakerNameOverrides(meetingId) {
  const saved = readStorageJson(buildKey('speaker_names', meetingId), {});
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

/**
 * Persists local speaker display name overrides keyed by speakerId/originalLabel.
 */
export function saveSpeakerNameOverrides(meetingId, nameMap) {
  const safeMap =
    nameMap && typeof nameMap === 'object' && !Array.isArray(nameMap) ? nameMap : {};
  writeStorageJson(buildKey('speaker_names', meetingId), safeMap);
  return safeMap;
}

/**
 * Calls the backend speaker rename endpoint for a persisted meeting.
 */
export async function renameSpeakerApi(meetingId, { speakerLabel, newName }) {
  if (!meetingId) {
    throw new Error('Thiếu mã cuộc họp để đổi tên người nói.');
  }
  return httpClient.put(`/meetings/${meetingId}/speakers/rename`, {
    speakerLabel,
    newName,
  });
}

