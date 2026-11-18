/**
 * SmartRec AI Explainability & Grounding Data Contract
 * Sprint 4 - Frontend Specification
 */

import { formatSecondsToTime, timeToSeconds } from "../utils/timeFormat.js";

export const CONFIDENCE_METHODOLOGY = Object.freeze({
  SEMANTIC_SIMILARITY: "SEMANTIC_SIMILARITY",
  LLM_LOGPROB: "LLM_LOGPROB",
  HEURISTIC_HYBRID: "HEURISTIC_HYBRID",
});

export const CONFIDENCE_METHODOLOGY_LABELS = Object.freeze({
  SEMANTIC_SIMILARITY: "Heuristic Khớp Ngữ Nghĩa (Cosine Similarity)",
  LLM_LOGPROB: "Xác Suất Hợp Lẽ Sinh Từ (LLM Logprob)",
  HEURISTIC_HYBRID: "Heuristic Kết Hợp (Hybrid Rule-based & NLP)",
});

export const UNCAlIBRATED_CONFIDENCE_DISCLAIMER =
  "Điểm số trên là chỉ số heuristic trích xuất ngữ nghĩa từ mô hình NLP, chưa hiệu chuẩn xác suất tuyệt đối trên tập dữ liệu gán nhãn thực nghiệm.";

/**
 * Chuẩn hóa dữ liệu Minh chứng (Evidence) cho cả Task và Summary
 * @param {Object} raw Dữ liệu thô từ API hoặc Mock
 * @param {Object} options Tùy chọn (loại đối tượng, fileType)
 * @returns {Object|null}
 */
export function normalizeExplainabilityEvidence(raw, options = {}) {
  if (!raw || typeof raw !== "object") return null;

  const targetType = options.type || raw.type || (raw.taskIndex || raw.task_index ? "task" : "summary");
  const targetIndex = Number(raw.taskIndex ?? raw.task_index ?? raw.summaryIndex ?? raw.summary_index ?? 1);
  const targetTitle = raw.taskContent || raw.content || raw.heading || raw.title || "Nội dung trích xuất";

  // Chuẩn hóa thời gian âm thanh
  const rawTimeStr = raw.timestamp || raw.time || (raw.timestampSeconds != null ? formatSecondsToTime(raw.timestampSeconds) : "00:00");
  const timestampSeconds = raw.timestampSeconds != null
    ? Number(raw.timestampSeconds)
    : timeToSeconds(rawTimeStr);

  const quoteText = raw.sourceText || raw.source_text || raw.quoteText || (raw.content ? `Nội dung thảo luận ghi nhận: "${raw.content}"` : "");

  // Audio evidence
  const sourceAudio = {
    timestamp: rawTimeStr,
    timestampSeconds: Number.isFinite(timestampSeconds) ? timestampSeconds : 0,
    speakerName: raw.speakerName || raw.speaker_name_temp || raw.speaker || raw.assignee || "Người tham gia",
    speakerId: raw.speakerId || raw.speaker_id || "spk_1",
    quoteText,
    contextTurns: Array.isArray(raw.contextSurrounding)
      ? raw.contextSurrounding.map((t) => ({
          speaker: t.speaker || "Người tham gia",
          time: t.time || "00:00",
          text: t.text || "",
          isKeyEvidence: Boolean(t.isKeyEvidence),
        }))
      : [
          {
            speaker: raw.speakerName || raw.assignee || "Người tham gia",
            time: rawTimeStr,
            text: quoteText,
            isKeyEvidence: true,
          },
        ],
  };

  // Slide evidence (nếu có trong dữ liệu)
  let sourceSlide = null;
  const slideRef = raw.slideReference || raw.sourceSlide;
  if (slideRef && typeof slideRef === "object") {
    sourceSlide = {
      slideId: slideRef.slideId || slideRef.slide_title || "slide-1",
      slideTitle: slideRef.slideTitle || slideRef.slide_title || "Slide thuyết trình",
      timestamp: slideRef.timestamp || slideRef.time || "00:00",
      timestampSeconds: slideRef.timestampSeconds != null ? Number(slideRef.timestampSeconds) : timeToSeconds(slideRef.timestamp || "00:00"),
      thumbnailUrl: slideRef.thumbnailUrl || null,
      ocrRawText: slideRef.ocrRawText || slideRef.raw_text || "",
      tags: Array.isArray(slideRef.tags) ? slideRef.tags : [],
    };
  }

  // Confidence & TR01: Minh bạch Heuristic
  const rawConf = typeof raw.heuristicConfidence === "number"
    ? raw.heuristicConfidence
    : typeof raw.confidence === "number"
      ? raw.confidence
      : 0.85;

  const confidenceScore = Math.max(0, Math.min(1, rawConf));
  const methodology = raw.methodology || CONFIDENCE_METHODOLOGY.SEMANTIC_SIMILARITY;

  // Metadata Audit & TR02
  const audit = {
    jobId: raw.jobId || "job-audit-trace",
    modelVersion: raw.modelVersion || "SmartRec-LLM-v2.4 (Whisper Large v3)",
    promptVersion: raw.promptVersion || "sys_task_matrix_prompt_v2.0",
    extractedAt: raw.extractedAt || new Date().toISOString(),
  };

  return {
    id: raw.id || `ev_${targetType}_${targetIndex}`,
    type: targetType,
    targetIndex,
    targetTitle,
    assignee: raw.assignee || null,
    responsible: raw.responsible || null,
    deadline: raw.deadline || null,
    priority: raw.priority || null,
    sourceAudio,
    sourceSlide,
    confidence: {
      score: confidenceScore,
      percentage: Math.round(confidenceScore * 100),
      methodology,
      methodologyLabel: CONFIDENCE_METHODOLOGY_LABELS[methodology] || CONFIDENCE_METHODOLOGY_LABELS.SEMANTIC_SIMILARITY,
      isCalibrated: false,
      disclaimer: UNCAlIBRATED_CONFIDENCE_DISCLAIMER,
    },
    audit,
  };
}

/**
 * Kiểm tra xem có được phép hiển thị minh chứng Slide hay không (TC-02 Audio-only Guard)
 * @param {string} fileType 'video' | 'audio'
 * @param {Object} evidence
 * @returns {boolean}
 */
export function shouldDisplaySlideEvidence(fileType, evidence) {
  if (fileType === "audio") return false;
  return Boolean(evidence?.sourceSlide);
}
