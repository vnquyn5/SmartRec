import React from "react";

const PIPELINE_STAGES = [
  {
    key: "FFMPEG",
    step: 1,
    label: "Audio Prep",
    title: "Trích xuất & Chuẩn hóa Audio",
    description: "Tách kênh âm thanh WAV 16kHz PCM Mono từ media gốc",
  },
  {
    key: "WEBRTC",
    step: 2,
    label: "WebRTC ANS",
    title: "Lọc ồn & Triệt tiếng vọng",
    description: "Thuật toán WebRTC APM khử tạp âm và tiếng dội phòng họp",
  },
  {
    key: "PYANNOTE",
    step: 3,
    label: "Diarization & STT",
    title: "Tách người nói & Chuyển giọng nói",
    description: "Mô hình PyAnnote phân loại Speaker & Whisper STT đa ngôn ngữ",
  },
  {
    key: "OUTPUT",
    step: 4,
    label: "AI Synthesis",
    title: "Tổng hợp Tóm tắt & Nhiệm vụ",
    description: "SmartRec NLP trích xuất biên bản tóm tắt và ma trận công việc",
  },
];

const STAGE_ORDER = {
  FFMPEG: 1,
  WEBRTC: 2,
  PYANNOTE: 3,
  OUTPUT: 4,
};

function Spinner({ className = "w-4 h-4" }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" className="opacity-20" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}

function AlertIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
  );
}

function PauseIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1"></rect>
      <rect x="14" y="4" width="4" height="16" rx="1"></rect>
    </svg>
  );
}

export default function PipelineJobStepper({
  currentStage = "PYANNOTE",
  jobStatus = "PROCESSING",
  errorCode,
  errorMessage,
  retryCount = 0,
  onRetry,
  onPause,
  onResume,
  onCancel,
  lifecycleAction = false,
  isReconnecting = false,
  className = "",
}) {
  const normStatus = String(jobStatus || "").toUpperCase();
  const currentStageNum = STAGE_ORDER[currentStage] || 3;
  const isCompleted = ["COMPLETED", "SUCCESS", "SUCCEEDED"].includes(normStatus);
  const isFailed = ["FAILED", "DLQ"].includes(normStatus);
  const isPaused = ["PAUSED", "PAUSE_REQUESTED"].includes(normStatus);
  const isCancelled = ["CANCELLED", "CANCEL_REQUESTED"].includes(normStatus);
  const isQueued = ["PENDING", "QUEUED"].includes(normStatus);
  const isRunning = ["PROCESSING", "RUNNING", "RETRYING"].includes(normStatus);

  // Không hiển thị stepper nếu cuộc họp chưa bao giờ được đưa vào pipeline xử lý
  if (normStatus === "UNPROCESSED") {
    return null;
  }

  return (
    <div className={`w-full bg-[#0a1122] border border-[#1b2640] rounded-2xl p-4 sm:p-5 font-sans shadow-lg transition-all ${className}`}>
      {/* Header Stepper & Controls */}
      <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-[#18233c]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0"></div>
          <div className="min-w-0">
            <h4 className="text-xs sm:text-sm font-bold text-[#f7f9ff] truncate flex items-center gap-2">
              <span>Tiến trình xử lý Pipeline AI</span>
              {isReconnecting && (
                <span className="text-[10px] font-normal text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                  Đang đồng bộ lại…
                </span>
              )}
            </h4>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">
              Phản ánh trạng thái thực tế từ backend worker (Zero-synthetic state)
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {isRunning && onPause && (
            <button
              type="button"
              disabled={lifecycleAction}
              onClick={onPause}
              className="px-2.5 py-1 text-[11px] font-semibold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg transition disabled:opacity-50 cursor-pointer"
            >
              Tạm dừng
            </button>
          )}
          {isPaused && onResume && (
            <button
              type="button"
              disabled={lifecycleAction}
              onClick={onResume}
              className="px-2.5 py-1 text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg transition disabled:opacity-50 cursor-pointer"
            >
              Tiếp tục
            </button>
          )}
          {isFailed && onRetry && (
            <button
              type="button"
              disabled={lifecycleAction}
              onClick={onRetry}
              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-sm"
            >
              Thử lại
            </button>
          )}
          {!isCompleted && !isCancelled && onCancel && (
            <button
              type="button"
              disabled={lifecycleAction}
              onClick={onCancel}
              className="px-2 py-1 text-[11px] text-slate-400 hover:text-white bg-[#141d31] hover:bg-[#1a253e] border border-[#233355] rounded-lg transition disabled:opacity-50 cursor-pointer"
            >
              Hủy
            </button>
          )}
        </div>
      </div>

      {/* Stepper Multi-stage Component */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 relative">
        {PIPELINE_STAGES.map((stage, idx) => {
          let stepStatus = "waiting"; // 'completed' | 'active' | 'failed' | 'paused' | 'waiting'

          if (isCompleted) {
            stepStatus = "completed";
          } else if (isFailed && stage.step === currentStageNum) {
            stepStatus = "failed";
          } else if (isFailed && stage.step < currentStageNum) {
            stepStatus = "completed";
          } else if (isPaused && stage.step === currentStageNum) {
            stepStatus = "paused";
          } else if (isPaused && stage.step < currentStageNum) {
            stepStatus = "completed";
          } else if (isQueued) {
            stepStatus = "waiting";
          } else {
            if (stage.step < currentStageNum) {
              stepStatus = "completed";
            } else if (stage.step === currentStageNum) {
              stepStatus = "active";
            } else {
              stepStatus = "waiting";
            }
          }

          return (
            <div
              key={stage.key}
              className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
                stepStatus === "active"
                  ? "bg-blue-950/30 border-blue-500/50 shadow-md shadow-blue-500/10 ring-1 ring-blue-500/20"
                  : stepStatus === "completed"
                    ? "bg-[#0c182b] border-emerald-500/30"
                    : stepStatus === "failed"
                      ? "bg-red-950/30 border-red-500/40"
                      : stepStatus === "paused"
                        ? "bg-amber-950/30 border-amber-500/40"
                        : "bg-[#080d19]/60 border-[#1a253e] opacity-75"
              }`}
            >
              {/* Stage Top Bar */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-slate-400">
                  0{stage.step}
                </span>

                {/* Status Icon */}
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    stepStatus === "completed"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : stepStatus === "active"
                        ? "bg-blue-500/20 text-blue-400"
                        : stepStatus === "failed"
                          ? "bg-red-500/20 text-red-400"
                          : stepStatus === "paused"
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-[#141e33] text-slate-500"
                  }`}
                >
                  {stepStatus === "completed" && <CheckIcon />}
                  {stepStatus === "active" && <Spinner />}
                  {stepStatus === "failed" && <AlertIcon />}
                  {stepStatus === "paused" && <PauseIcon />}
                  {stepStatus === "waiting" && <span className="text-xs font-bold">•</span>}
                </div>
              </div>

              {/* Stage Content */}
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <h5 className="text-xs font-bold text-[#f7f9ff] truncate">
                    {stage.label}
                  </h5>
                </div>
                <p className="text-[10px] text-slate-400 line-clamp-2 leading-tight">
                  {stage.title}
                </p>
              </div>

              {/* Status Bottom Badge */}
              <div className="mt-2.5 pt-2 border-t border-[#18233c]/80 flex items-center justify-between text-[10px]">
                {stepStatus === "completed" && (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    ✓ Hoàn tất
                  </span>
                )}
                {stepStatus === "active" && (
                  <span className="text-blue-400 font-semibold flex items-center gap-1">
                    Đang xử lý…
                  </span>
                )}
                {stepStatus === "failed" && (
                  <span className="text-red-400 font-semibold flex items-center gap-1">
                    Thất bại {errorCode ? `(${errorCode})` : ""}
                  </span>
                )}
                {stepStatus === "paused" && (
                  <span className="text-amber-400 font-semibold flex items-center gap-1">
                    Đã tạm dừng
                  </span>
                )}
                {stepStatus === "waiting" && (
                  <span className="text-slate-500">Chờ tới lượt</span>
                )}
                {retryCount > 0 && stepStatus === "active" && (
                  <span className="text-amber-300 font-mono">Lần {retryCount}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Error / Alert detail if failed */}
      {isFailed && errorMessage && (
        <div className="mt-3 p-2.5 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs flex items-start gap-2">
          <AlertIcon className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
          <div className="min-w-0">
            <span className="font-bold">Chi tiết sự cố: </span>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}
