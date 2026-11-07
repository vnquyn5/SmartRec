import React, { useEffect } from "react";
import { formatSecondsToTime } from "../../utils/timeFormat";

export default function ExplainabilityDrawer({
  isOpen = false,
  evidence = null,
  onClose,
  onSeekMedia,
}) {
  // Lắng nghe phím Escape để đóng Drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePlayEvidence = () => {
    if (evidence?.timestampSeconds != null && typeof onSeekMedia === "function") {
      onSeekMedia(evidence.timestampSeconds);
    }
  };

  const confidencePercent = evidence?.heuristicConfidence != null
    ? Math.round(evidence.heuristicConfidence * 100)
    : null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden font-sans">
      {/* Backdrop mờ */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-lg bg-[#0c1324] border-l border-[#1e2a44] shadow-2xl flex flex-col justify-between text-slate-200">
          
          {/* Header */}
          <div className="px-5 py-4 border-b border-[#1b2640] flex items-center justify-between bg-[#080d19]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-blue-400 shrink-0 shadow-sm">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white tracking-wide truncate">
                  Minh Chứng Trích Xuất AI (Grounding)
                </h3>
                <p className="text-[11px] text-slate-400 truncate">
                  Đối soát ngữ cảnh gốc tạo nên nhiệm vụ này
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#162035] transition cursor-pointer"
              title="Đóng (Esc)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          {/* Drawer Body Scroll */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {evidence ? (
              <>
                {/* 1. Thông tin Nhiệm vụ / Task */}
                <div className="bg-[#10172a] border border-[#1e2a44] rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30">
                      Nhiệm vụ #{evidence.taskIndex || 1}
                    </span>
                    {evidence.deadline && (
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <span>Hạn chót:</span>
                        <strong className="text-slate-200">{evidence.deadline}</strong>
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-white leading-relaxed">
                    {evidence.taskContent}
                  </h4>
                  {evidence.assignee && (
                    <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
                      <span>Người phụ trách:</span>
                      <span className="px-2 py-0.5 rounded-md bg-[#162238] text-blue-300 font-medium border border-blue-500/20">
                        {evidence.assignee}
                      </span>
                    </div>
                  )}
                </div>

                {/* 2. Đoạn trích dẫn gốc (Source Evidence) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                      <span>Dẫn chứng nguyên văn từ cuộc họp</span>
                    </label>
                    <span className="text-[11px] text-cyan-400 font-mono">
                      Mốc: {evidence.timestamp || formatSecondsToTime(evidence.timestampSeconds)}
                    </span>
                  </div>

                  <div className="relative bg-[#091124] border-2 border-cyan-500/40 rounded-2xl p-4 shadow-md">
                    {/* Speaker Header */}
                    <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-cyan-500/20">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold flex items-center justify-center">
                          {evidence.speakerName?.charAt(0) || "S"}
                        </div>
                        <span className="text-xs font-bold text-white">
                          {evidence.speakerName || "Người phát biểu"}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {evidence.speakerId ? `[${evidence.speakerId}]` : ""}
                      </span>
                    </div>

                    {/* Source quote */}
                    <p className="text-xs sm:text-sm text-slate-100 italic leading-relaxed">
                      "{evidence.sourceText || "Không có nội dung trích dẫn văn bản tương ứng."}"
                    </p>

                    {/* Action Seek Video */}
                    <div className="mt-4 pt-3 border-t border-cyan-500/20 flex justify-end">
                      <button
                        type="button"
                        onClick={handlePlayEvidence}
                        className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-500/20 active:scale-95 transition cursor-pointer"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        <span>Phát đoạn hội thoại này ({evidence.timestamp || formatSecondsToTime(evidence.timestampSeconds)})</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* 3. Ngữ cảnh trước & sau (Context Turns) */}
                {evidence.contextSurrounding && evidence.contextSurrounding.length > 0 && (
                  <div>
                    <h5 className="text-xs font-bold text-slate-400 mb-2">
                      Mạch trao đổi xung quanh (Context Turns)
                    </h5>
                    <div className="space-y-2">
                      {evidence.contextSurrounding.map((turn, idx) => (
                        <div
                          key={idx}
                          className={`p-2.5 rounded-xl border text-xs leading-relaxed ${
                            turn.isKeyEvidence
                              ? "bg-cyan-950/25 border-cyan-500/40 text-cyan-100 font-medium"
                              : "bg-[#0b101e] border-[#18233c] text-slate-400"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                            <span className="font-semibold text-slate-300">{turn.speaker}</span>
                            <span className="font-mono">{turn.time}</span>
                          </div>
                          <p>{turn.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. Khối Độ tin cậy Heuristic & Metadata Model (TR01, TR02) */}
                <div className="bg-[#0b1122] border border-[#1b2742] rounded-2xl p-3.5 space-y-2.5">
                  {/* TR01: Heuristic Confidence warning */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-300 font-semibold">Chỉ số khớp ngữ nghĩa:</span>
                      <span className="font-mono font-bold text-emerald-400">
                        {confidencePercent != null ? `${confidencePercent}%` : "--"}
                      </span>
                    </div>
                    {/* Progress indicator */}
                    <div className="w-full h-1.5 bg-[#162035] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${confidencePercent || 0}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-amber-300/80 mt-1.5 leading-snug">
                      * <strong>Lưu ý:</strong> Điểm số trên là heuristic trích xuất ngữ nghĩa từ mô hình NLP, chưa hiệu chuẩn xác suất tuyệt đối trên tập gán nhãn thực tế.
                    </p>
                  </div>

                  {/* TR02: Model & Prompt Version Metadata */}
                  <div className="pt-2 border-t border-[#18233c] grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                    <div>
                      <span className="text-slate-500 block">Model Engine:</span>
                      <span className="text-slate-300 font-mono truncate block">
                        {evidence.modelVersion || "Whisper-Large-v3"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Prompt Spec:</span>
                      <span className="text-slate-300 font-mono truncate block">
                        {evidence.promptVersion || "sys_task_matrix_v2.0"}
                      </span>
                    </div>
                    {evidence.jobId && (
                      <div className="col-span-2">
                        <span className="text-slate-500 block">Job Audit Trace:</span>
                        <span className="text-slate-300 font-mono text-[9px]">
                          {evidence.jobId}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* Fallback Empty State (BR03) */
              <div className="py-12 text-center">
                <div className="w-12 h-12 rounded-2xl bg-[#141e33] border border-[#223352] flex items-center justify-center mx-auto mb-3 text-slate-400">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                </div>
                <h4 className="text-sm font-bold text-white mb-1">
                  Không tìm thấy minh chứng tự động
                </h4>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Nhiệm vụ này có thể được tạo thủ công hoặc chưa có câu thoại đối soát khớp trong biên bản cuộc họp.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-[#18233c] bg-[#080d19] flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#141e33] hover:bg-[#1a2744] text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
            >
              Đóng lại
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
