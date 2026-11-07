import React, { useEffect, useState } from "react";
import { formatSecondsToTime } from "../../utils/timeFormat";
import {
  CONFIDENCE_METHODOLOGY_LABELS,
  UNCAlIBRATED_CONFIDENCE_DISCLAIMER,
  normalizeExplainabilityEvidence,
  shouldDisplaySlideEvidence,
} from "../../types/explainability";

/* -------------------------------------------------------------------------- */
/* Micro SVG Icons                                                            */
/* -------------------------------------------------------------------------- */
function PlayIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function SlideIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function ShieldAlertIcon({ className = "w-8 h-8" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function InfoIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

/**
 * Component ExplainabilityDrawer (Sprint 4 - SmartRec FE)
 * Hiển thị chi tiết căn cứ trích xuất của AI (Grounding) cho cả Task và Summary
 */
export default function ExplainabilityDrawer({
  isOpen = false,
  evidence: rawEvidence = null,
  fileType = "video", // 'video' | 'audio' (TC-02 Audio-only Guard)
  isPermissionDenied = false,
  isDeleted = false,
  onClose,
  onSeekMedia,
  onSeekSlide,
}) {
  const [expandedText, setExpandedText] = useState(false);

  // Đóng Drawer khi nhấn phím Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Reset trạng thái mở rộng khi đổi evidence
  useEffect(() => {
    setExpandedText(false);
  }, [rawEvidence]);

  if (!isOpen) return null;

  // Chuẩn hóa dữ liệu theo Data Contract
  const evidence = normalizeExplainabilityEvidence(rawEvidence, { fileType });

  // Phát câu thoại âm thanh tại timestamp
  const handlePlayAudio = () => {
    const seconds = evidence?.sourceAudio?.timestampSeconds;
    if (seconds != null && typeof onSeekMedia === "function") {
      onSeekMedia(seconds);
    }
  };

  // Nhảy đến Slide Keyframe
  const handleJumpToSlide = () => {
    const slideSec = evidence?.sourceSlide?.timestampSeconds;
    if (slideSec != null && typeof onSeekSlide === "function") {
      onSeekSlide(slideSec);
    } else if (slideSec != null && typeof onSeekMedia === "function") {
      onSeekMedia(slideSec);
    }
  };

  // Tiêu chí TC-02: Không hiển thị Slide khi là Audio-only
  const canShowSlide = shouldDisplaySlideEvidence(fileType, evidence);

  const confidencePct = evidence?.confidence?.percentage ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chi tiết minh chứng trích xuất AI"
      className="fixed inset-0 z-50 overflow-hidden font-sans"
    >
      {/* Backdrop mờ */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm transition-opacity duration-300"
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-xl bg-[#0c1324] border-l border-[#1e2a44] shadow-2xl flex flex-col justify-between text-slate-200 animate-in slide-in-from-right duration-300">
          
          {/* HEADER */}
          <div className="px-5 py-4 border-b border-[#1b2640] flex items-center justify-between bg-[#080d19]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 shadow-sm">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white tracking-wide truncate flex items-center gap-2">
                  <span>Minh Chứng Trích Xuất AI (Grounding)</span>
                  {fileType === "audio" && (
                    <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                      Audio-only
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-400 truncate">
                  Đối soát ngữ cảnh gốc tạo nên kết luận / nhiệm vụ này
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng ngăn chi tiết"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#162035] transition cursor-pointer"
              title="Đóng (Esc)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* DRAWER BODY (SCROLLABLE) */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* 1. Trạng thái Quyền truy cập bị từ chối (403 Forbidden) */}
            {isPermissionDenied ? (
              <div className="py-12 text-center bg-[#10172a] rounded-2xl border border-red-500/30 p-6">
                <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/25 flex items-center justify-center mx-auto mb-3 text-red-400">
                  <ShieldAlertIcon />
                </div>
                <h4 className="text-sm font-bold text-white mb-1">
                  Truy cập bị từ chối (Permission Denied)
                </h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Bạn không có quyền xem minh chứng nội dung và câu thoại của cuộc họp này. Vui lòng liên hệ quản trị viên Workspace.
                </p>
              </div>
            ) : isDeleted ? (
              /* 2. Trạng thái Artifact đã bị xóa */
              <div className="py-12 text-center bg-[#10172a] rounded-2xl border border-amber-500/30 p-6">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center mx-auto mb-3 text-amber-400">
                  <InfoIcon className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-white mb-1">
                  Minh chứng không còn tồn tại
                </h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Bản ghi âm hoặc tệp minh chứng liên kết với mục này đã bị xóa hoặc chuyển vào thùng rác.
                </p>
              </div>
            ) : evidence ? (
              <>
                {/* 3. KHỐI THÔNG TIN MỤC TRÍCH XUẤT (Task hoặc Summary) */}
                <div className="bg-[#10172a] border border-[#1e2a44] rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                      {evidence.type === "task" ? `Nhiệm vụ #${evidence.targetIndex}` : `Tóm tắt mục tiêu #${evidence.targetIndex}`}
                    </span>
                    {evidence.deadline && (
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <span>Hạn chót:</span>
                        <strong className="text-slate-200">{evidence.deadline}</strong>
                      </span>
                    )}
                  </div>

                  {/* Nội dung với Text Expander (Xem thêm / Thu gọn cho nội dung dài) */}
                  <div className="relative">
                    <p className={`text-sm font-semibold text-white leading-relaxed ${!expandedText && evidence.targetTitle?.length > 160 ? "line-clamp-3" : ""}`}>
                      {evidence.targetTitle}
                    </p>
                    {evidence.targetTitle?.length > 160 && (
                      <button
                        type="button"
                        onClick={() => setExpandedText(!expandedText)}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium mt-1 cursor-pointer focus:outline-none"
                      >
                        {expandedText ? "▲ Thu gọn" : "▼ Xem thêm toàn bộ"}
                      </button>
                    )}
                  </div>

                  {/* Metadata bổ sung nếu là Task */}
                  {(evidence.assignee || evidence.responsible) && (
                    <div className="mt-3 pt-2.5 border-t border-[#18233c] flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                      {evidence.assignee && (
                        <div className="flex items-center gap-1.5">
                          <span>Người thực hiện:</span>
                          <span className="px-2 py-0.5 rounded-md bg-[#162238] text-blue-300 font-medium border border-blue-500/20">
                            {evidence.assignee}
                          </span>
                        </div>
                      )}
                      {evidence.responsible && (
                        <div className="flex items-center gap-1.5">
                          <span>Giám sát:</span>
                          <span className="text-slate-300">{evidence.responsible}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 4. KHỐI NGUỒN 1: DẪN CHỨNG ÂM THANH (Audio Transcript Grounding) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      <span>Căn cứ từ lời thoại cuộc họp (Audio Transcript)</span>
                    </label>
                    <span className="text-[11px] text-cyan-400 font-mono font-bold">
                      Mốc: {evidence.sourceAudio.timestamp || formatSecondsToTime(evidence.sourceAudio.timestampSeconds)}
                    </span>
                  </div>

                  <div className="relative bg-[#091124] border-2 border-cyan-500/40 rounded-2xl p-4 shadow-md">
                    {/* Speaker Header */}
                    <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-cyan-500/20">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold flex items-center justify-center">
                          {evidence.sourceAudio.speakerName?.charAt(0) || "S"}
                        </div>
                        <span className="text-xs font-bold text-white">
                          {evidence.sourceAudio.speakerName}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        [{evidence.sourceAudio.speakerId}]
                      </span>
                    </div>

                    {/* Source quote */}
                    <blockquote className="text-xs sm:text-sm text-slate-100 italic leading-relaxed pl-2 border-l-2 border-cyan-400/60">
                      "{evidence.sourceAudio.quoteText || "Không có nội dung trích dẫn văn bản tương ứng."}"
                    </blockquote>

                    {/* Action Seek Audio/Video */}
                    <div className="mt-3.5 pt-2.5 border-t border-cyan-500/20 flex justify-end">
                      <button
                        type="button"
                        onClick={handlePlayAudio}
                        className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-500/20 active:scale-95 transition cursor-pointer"
                        title="Tua đến mốc thời gian này"
                      >
                        <PlayIcon className="w-3 h-3" />
                        <span>Phát đoạn hội thoại này ({evidence.sourceAudio.timestamp})</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* 5. KHỐI NGUỒN 2: DẪN CHỨNG TỪ SLIDE THUYẾT TRÌNH (TC-02 Audio-only Guard) */}
                {canShowSlide && evidence.sourceSlide && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <SlideIcon className="w-3.5 h-3.5 text-purple-400" />
                        <span>Căn cứ từ Slide thuyết trình (Slide OCR)</span>
                      </label>
                      <span className="text-[11px] text-purple-400 font-mono">
                        Mốc: {evidence.sourceSlide.timestamp}
                      </span>
                    </div>

                    <div className="bg-[#101426] border border-purple-500/30 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <h5 className="text-xs font-bold text-white">
                            {evidence.sourceSlide.slideTitle}
                          </h5>
                          {evidence.sourceSlide.tags?.length > 0 && (
                            <div className="flex gap-1.5 mt-1.5 flex-wrap">
                              {evidence.sourceSlide.tags.map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={handleJumpToSlide}
                          className="px-2.5 py-1 rounded-lg bg-purple-600/80 hover:bg-purple-600 text-white text-[11px] font-semibold transition shrink-0 cursor-pointer shadow-sm active:scale-95"
                        >
                          Xem Slide ({evidence.sourceSlide.timestamp})
                        </button>
                      </div>

                      {evidence.sourceSlide.ocrRawText && (
                        <div className="mt-2.5 p-2 rounded-lg bg-[#0a0d1a] border border-[#1a2038] text-[11px] font-mono text-slate-300">
                          <span className="text-slate-500 block text-[10px] mb-0.5">Văn bản OCR nhận diện:</span>
                          <p className="line-clamp-2">{evidence.sourceSlide.ocrRawText}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 6. MẠCH HỘI THOẠI XUNG QUANH (Context Turns) */}
                {evidence.sourceAudio.contextTurns && evidence.sourceAudio.contextTurns.length > 0 && (
                  <div>
                    <h5 className="text-xs font-bold text-slate-400 mb-2">
                      Mạch trao đổi ngữ cảnh (Context Turns)
                    </h5>
                    <div className="space-y-1.5">
                      {evidence.sourceAudio.contextTurns.map((turn, idx) => (
                        <div
                          key={idx}
                          className={`p-2.5 rounded-xl border text-xs leading-relaxed transition ${
                            turn.isKeyEvidence
                              ? "bg-cyan-950/25 border-cyan-500/40 text-cyan-100 font-medium shadow-sm"
                              : "bg-[#0b101e] border-[#18233c] text-slate-400 opacity-80"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                              {turn.isKeyEvidence && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                              <span>{turn.speaker}</span>
                            </span>
                            <span className="font-mono">{turn.time}</span>
                          </div>
                          <p>{turn.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 7. KHỐI MINH BẠCH ĐỘ TIN CẬY (TR01 Transparent Confidence) */}
                <div className="bg-[#0b1122] border border-[#1b2742] rounded-2xl p-4 space-y-2.5">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                        <InfoIcon className="text-cyan-400 w-3 h-3" />
                        <span>{evidence.confidence.methodologyLabel}:</span>
                      </span>
                      <span className="font-mono font-bold text-emerald-400 text-sm">
                        {confidencePct != null ? `${confidencePct}%` : "--"}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 bg-[#162035] rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          confidencePct >= 80
                            ? "bg-emerald-500"
                            : confidencePct >= 60
                              ? "bg-amber-500"
                              : "bg-blue-500"
                        }`}
                        style={{ width: `${confidencePct || 0}%` }}
                      />
                    </div>

                    {/* Cảnh báo bắt buộc theo TR01: Uncalibrated Heuristic */}
                    <div className="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200/90 leading-tight flex items-start gap-1.5">
                      <InfoIcon className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span>{evidence.confidence.disclaimer || UNCAlIBRATED_CONFIDENCE_DISCLAIMER}</span>
                    </div>
                  </div>

                  {/* 8. KHỐI AUDIT KIỂM TOÁN MÔ HÌNH (TR02) */}
                  <div className="pt-2.5 border-t border-[#18233c] grid grid-cols-2 gap-2 text-[10px] text-slate-400 font-mono">
                    <div>
                      <span className="text-slate-500 block">Model Engine:</span>
                      <span className="text-slate-300 truncate block">
                        {evidence.audit.modelVersion}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Prompt Spec:</span>
                      <span className="text-slate-300 truncate block">
                        {evidence.audit.promptVersion}
                      </span>
                    </div>
                    {evidence.audit.jobId && (
                      <div className="col-span-2">
                        <span className="text-slate-500 block">Job Audit Trace:</span>
                        <span className="text-slate-300 text-[9px] break-all">
                          {evidence.audit.jobId}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* Fallback Empty State (BR03 Không tạo kết quả giả) */
              <div className="py-12 text-center">
                <div className="w-12 h-12 rounded-2xl bg-[#141e33] border border-[#223352] flex items-center justify-center mx-auto mb-3 text-slate-400">
                  <InfoIcon className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-white mb-1">
                  Không tìm thấy minh chứng tự động
                </h4>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Mục này có thể được tạo thủ công hoặc chưa có câu thoại đối soát khớp trong biên bản cuộc họp.
                </p>
              </div>
            )}
          </div>

          {/* FOOTER */}
          <div className="px-5 py-3 border-t border-[#18233c] bg-[#080d19] flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#141e33] hover:bg-[#1a2744] text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer active:scale-95"
            >
              Đóng lại
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
