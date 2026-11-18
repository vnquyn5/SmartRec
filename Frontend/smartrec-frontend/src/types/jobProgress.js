/**
 * SmartRec Pipeline & WebSocket Data Contract Definitions
 * Sprint 4 - Frontend Specification
 */

export const PIPELINE_STAGES = Object.freeze([
  {
    key: "FFMPEG",
    step: 1,
    label: "Audio Prep",
    title: "Trích xuất & Chuẩn hóa Audio",
    description: "Tách kênh âm thanh WAV 16kHz PCM Mono từ media gốc",
    startPct: 0,
    endPct: 25,
  },
  {
    key: "WEBRTC",
    step: 2,
    label: "WebRTC ANS",
    title: "Lọc ồn & Triệt tiếng vọng",
    description: "Thuật toán WebRTC APM khử tạp âm và tiếng dội phòng họp",
    startPct: 25,
    endPct: 50,
  },
  {
    key: "PYANNOTE",
    step: 3,
    label: "Diarization & STT",
    title: "Tách người nói & Chuyển giọng nói",
    description: "Mô hình PyAnnote phân loại Speaker & Whisper STT đa ngôn ngữ",
    startPct: 50,
    endPct: 85,
  },
  {
    key: "OUTPUT",
    step: 4,
    label: "AI Synthesis",
    title: "Tổng hợp Tóm tắt & Nhiệm vụ",
    description: "SmartRec NLP trích xuất biên bản tóm tắt và ma trận công việc",
    startPct: 85,
    endPct: 100,
  },
]);

export const STAGE_ORDER = Object.freeze({
  FFMPEG: 1,
  WEBRTC: 2,
  PYANNOTE: 3,
  OUTPUT: 4,
});

export const STAGE_KEY_LIST = ["FFMPEG", "WEBRTC", "PYANNOTE", "OUTPUT"];

export const JOB_STATUS = Object.freeze({
  PENDING: "PENDING",
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  PROCESSING: "PROCESSING",
  RETRYING: "RETRYING",
  PAUSE_REQUESTED: "PAUSE_REQUESTED",
  PAUSED: "PAUSED",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
  SUCCESS: "SUCCESS",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  DLQ: "DLQ",
});

export const SOCKET_CONNECTION_STATE = Object.freeze({
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  RECONNECTING: "RECONNECTING",
  DEGRADED: "DEGRADED",
  OFFLINE: "OFFLINE",
  DISCONNECTED: "DISCONNECTED",
});

/**
 * Trạng thái hoàn tất
 */
export function isStatusCompleted(status) {
  const norm = String(status || "").toUpperCase();
  return ["COMPLETED", "SUCCESS", "SUCCEEDED"].includes(norm);
}

/**
 * Trạng thái thất bại (tuyệt đối không hiển thị 100%)
 */
export function isStatusFailed(status) {
  const norm = String(status || "").toUpperCase();
  return ["FAILED", "DLQ"].includes(norm);
}

/**
 * Trạng thái đang chạy
 */
export function isStatusRunning(status) {
  const norm = String(status || "").toUpperCase();
  return ["PROCESSING", "RUNNING", "RETRYING"].includes(norm);
}

/**
 * Trạng thái tạm dừng
 */
export function isStatusPaused(status) {
  const norm = String(status || "").toUpperCase();
  return ["PAUSED", "PAUSE_REQUESTED"].includes(norm);
}

/**
 * Trạng thái đã hủy
 */
export function isStatusCancelled(status) {
  const norm = String(status || "").toUpperCase();
  return ["CANCELLED", "CANCEL_REQUESTED"].includes(norm);
}

/**
 * Trạng thái trong hàng đợi
 */
export function isStatusQueued(status) {
  const norm = String(status || "").toUpperCase();
  return ["PENDING", "QUEUED"].includes(norm);
}

/**
 * Tính toán phần trăm tiến độ tổng thể dựa trên stage và micro-percentage
 * @param {string} stage
 * @param {number|undefined} stagePercentage 0 - 100
 * @param {string} status
 * @returns {number} 0 - 100
 */
export function computeOverallProgress(stage, stagePercentage, status) {
  if (isStatusCompleted(status)) return 100;
  if (isStatusQueued(status)) return 2;

  const stageCfg = PIPELINE_STAGES.find((s) => s.key === stage) || PIPELINE_STAGES[0];
  const { startPct, endPct } = stageCfg;

  if (isStatusFailed(status)) {
    // Không làm giả 100% khi lỗi; giữ lại mốc tiến độ đạt được ở đầu hoặc giữa chặng lỗi
    const micro = typeof stagePercentage === "number" && !Number.isNaN(stagePercentage)
      ? Math.max(0, Math.min(100, stagePercentage))
      : 30;
    const progress = startPct + ((endPct - startPct) * micro) / 100;
    return Math.min(99, Math.max(startPct, Math.round(progress)));
  }

  const micro = typeof stagePercentage === "number" && !Number.isNaN(stagePercentage)
    ? Math.max(0, Math.min(100, stagePercentage))
    : 15;

  const calculated = startPct + ((endPct - startPct) * micro) / 100;
  // Giữ tiến độ trong khoảng 2% đến 99% nếu chưa COMPLETED
  return Math.min(99, Math.max(2, Math.round(calculated)));
}

/**
 * Chuẩn hóa payload nhận từ WebSocket hoặc REST Snapshot
 */
export function normalizeJobPayload(raw, currentJobId = null) {
  if (!raw || typeof raw !== "object") return null;

  const jobId = raw.jobId || raw.id || raw.activeJobId || null;
  // Nếu có currentJobId chỉ định, bảo vệ chống stale job
  if (currentJobId && jobId && String(jobId) !== String(currentJobId)) {
    return null;
  }

  const stage = String(raw.stage || raw.currentStage || "FFMPEG").toUpperCase();
  const status = String(raw.status || "PROCESSING").toUpperCase();
  const retryCount = Number(raw.retryCount) || 0;
  const errorCode = raw.errorCode || null;
  const errorMessage = raw.errorMessage || null;
  const eventId = raw.eventId || (raw.updatedAt ? `snap_${new Date(raw.updatedAt).getTime()}` : null);
  const updatedAt = raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString();

  // Percentage tổng thể
  let percentage = typeof raw.percentage === "number" ? Math.max(0, Math.min(100, raw.percentage)) : null;
  const stagePercentage = typeof raw.stagePercentage === "number"
    ? Math.max(0, Math.min(100, raw.stagePercentage))
    : (percentage !== null ? percentage : 0);

  if (percentage === null) {
    percentage = computeOverallProgress(stage, stagePercentage, status);
  }

  // Tiêu chí TR01 & BR03: Không cho phép FAILED đạt 100%
  if (isStatusFailed(status) && percentage >= 100) {
    percentage = 95;
  }

  return {
    eventId,
    jobId,
    meetingId: raw.meetingId || null,
    stage: STAGE_ORDER[stage] ? stage : "FFMPEG",
    status,
    percentage: Math.round(percentage),
    stagePercentage: Math.round(stagePercentage),
    message: raw.message || raw.statusMessage || null,
    errorCode,
    errorMessage,
    retryCount,
    updatedAt,
  };
}
