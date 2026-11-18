import React, { useMemo } from "react";
import { useJobProgressSocket } from "../../hooks/useJobProgressSocket";
import {
  PIPELINE_STAGES,
  STAGE_ORDER,
  isStatusCompleted,
  isStatusFailed,
  isStatusPaused,
  isStatusCancelled,
  isStatusQueued,
  isStatusRunning,
  computeOverallProgress,
} from "../../types/jobProgress";

/* -------------------------------------------------------------------------- */
/* SVG Micro-Icons                                                            */
/* -------------------------------------------------------------------------- */
function SpinnerIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function PauseIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function WifiIcon({ className = "w-3 h-3" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

function RefreshCwIcon({ className = "w-3 h-3" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* RealtimeStepper Component                                                  */
/* -------------------------------------------------------------------------- */
export default function RealtimeStepper({
  jobId,
  meetingId,
  initialJob = null,
  currentStage: propStage,
  jobStatus: propStatus,
  errorCode: propErrorCode,
  errorMessage: propErrorMessage,
  retryCount: propRetryCount = 0,
  onRetry,
  onPause,
  onResume,
  onCancel,
  lifecycleAction = false,
  showControls = true,
  showOverallProgressBar = true,
  className = "",
  onJobCompleted,
  onJobFailed,
}) {
  // Lắng nghe dữ liệu WebSocket STOMP kèm auto-reconnect và REST snapshot fallback
  const {
    jobState,
    isConnected,
    isDegraded,
    isOffline,
    reconnectAttempts,
    syncSnapshot,
  } = useJobProgressSocket({
    jobId: jobId || initialJob?.id,
    meetingId,
    initialJob,
    enabled: Boolean(jobId || initialJob?.id),
    onJobCompleted,
    onJobFailed,
  });

  // Hợp nhất dữ liệu giữa WebSocket realtime (ưu tiên) và props fallback từ cha
  const activeStage = jobState?.stage || propStage || "FFMPEG";
  const activeStatus = jobState?.status || propStatus || "PROCESSING";
  const activeErrorCode = jobState?.errorCode || propErrorCode;
  const activeErrorMessage = jobState?.errorMessage || propErrorMessage;
  const activeRetryCount = typeof jobState?.retryCount === "number" ? jobState.retryCount : propRetryCount;
  const stagePercentage = typeof jobState?.stagePercentage === "number" ? jobState.stagePercentage : 0;

  // Tính toán trạng thái nghiệp vụ
  const normStatus = String(activeStatus || "").toUpperCase();
  const currentStageNum = STAGE_ORDER[activeStage] || 1;
  const isCompleted = isStatusCompleted(normStatus);
  const isFailed = isStatusFailed(normStatus);
  const isPaused = isStatusPaused(normStatus);
  const isCancelled = isStatusCancelled(normStatus);
  const isQueued = isStatusQueued(normStatus);
  const isRunning = isStatusRunning(normStatus);

  // Không hiển thị stepper nếu cuộc họp chưa bao giờ đưa vào pipeline
  if (normStatus === "UNPROCESSED") {
    return null;
  }

  // Tính phần trăm tiến độ tổng thể (Zero-synthetic: khi FAILED không bao giờ được 100%)
  const overallProgress = useMemo(() => {
    if (typeof jobState?.percentage === "number") {
      return isFailed ? Math.min(95, jobState.percentage) : jobState.percentage;
    }
    return computeOverallProgress(activeStage, stagePercentage, normStatus);
  }, [jobState?.percentage, activeStage, stagePercentage, normStatus, isFailed]);

  // Trạng thái hiển thị badge kết nối
  const connectionBadge = useMemo(() => {
    if (isConnected) {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 shadow-sm"
          title="Đang nhận luồng sự kiện trực tiếp từ WebSocket STOMP"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Live WebSocket</span>
        </span>
      );
    }
    if (isDegraded) {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30"
          title={`Đang thử kết nối lại với máy chủ (Lần ${reconnectAttempts})`}
        >
          <SpinnerIcon className="w-2.5 h-2.5" />
          <span>Tái kết nối #{reconnectAttempts}</span>
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-500/15 text-slate-300 border border-slate-500/20"
        title="Đang đồng bộ qua giao thức HTTP REST Snapshot"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        <span>HTTP Snapshot</span>
      </span>
    );
  }, [isConnected, isDegraded, reconnectAttempts]);

  return (
    <section
      aria-label="Tiến trình xử lý Pipeline AI"
      className={`w-full bg-[#0a1122] border border-[#1b2640] rounded-2xl p-4 sm:p-5 font-sans shadow-xl transition-all ${className}`}
    >
      {/* HEADER & CONTROLS */}
      <div className="flex items-center justify-between gap-3 mb-3.5 pb-3 border-b border-[#18233c]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isCompleted
                ? "bg-emerald-400"
                : isFailed
                  ? "bg-red-400 animate-ping"
                  : isPaused
                    ? "bg-amber-400"
                    : "bg-blue-400 animate-pulse"
            }`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-bold text-[#f7f9ff] tracking-tight truncate">
                Tiến trình xử lý Pipeline AI
              </h3>
              {connectionBadge}
            </div>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">
              Phản ánh trạng thái thực tế từ backend worker (Zero-synthetic state)
            </p>
          </div>
        </div>

        {/* Action Controls */}
        {showControls && (
          <div className="flex items-center gap-2 shrink-0">
            {isRunning && onPause && (
              <button
                type="button"
                disabled={lifecycleAction}
                onClick={onPause}
                aria-label="Tạm dừng xử lý AI"
                className="px-2.5 py-1 text-[11px] font-semibold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-sm active:scale-95"
              >
                Tạm dừng
              </button>
            )}
            {isPaused && onResume && (
              <button
                type="button"
                disabled={lifecycleAction}
                onClick={onResume}
                aria-label="Tiếp tục xử lý AI"
                className="px-2.5 py-1 text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-sm active:scale-95"
              >
                Tiếp tục
              </button>
            )}
            {isFailed && onRetry && (
              <button
                type="button"
                disabled={lifecycleAction}
                onClick={onRetry}
                aria-label="Thử lại xử lý AI"
                className="px-3 py-1 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition disabled:opacity-50 cursor-pointer shadow-md shadow-blue-600/25 active:scale-95"
              >
                Thử lại
              </button>
            )}
            {!isCompleted && !isCancelled && onCancel && (
              <button
                type="button"
                disabled={lifecycleAction}
                onClick={onCancel}
                aria-label="Hủy tác vụ AI"
                className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-white bg-[#141d31] hover:bg-[#1a253e] border border-[#233355] rounded-lg transition disabled:opacity-50 cursor-pointer active:scale-95"
              >
                Hủy
              </button>
            )}
          </div>
        )}
      </div>

      {/* OVERALL REALTIME PROGRESS BAR (0 - 100%) */}
      {showOverallProgressBar && (
        <div className="mb-4 bg-[#0d1629] p-3 rounded-xl border border-[#1b2640]">
          <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300 flex items-center gap-1.5">
              <span>Tiến độ tổng thể:</span>
              <strong className="text-white font-mono">{overallProgress}%</strong>
              {isRunning && (
                <span className="text-[10px] text-blue-400 font-normal">
                  (Chặng {currentStageNum}/4: {PIPELINE_STAGES[currentStageNum - 1]?.label})
                </span>
              )}
            </span>
            <span
              className={`text-[11px] font-semibold ${
                isCompleted
                  ? "text-emerald-400"
                  : isFailed
                    ? "text-red-400"
                    : isPaused
                      ? "text-amber-400"
                      : "text-blue-400"
              }`}
            >
              {isCompleted && "✓ Đã xử lý thành công 100%"}
              {isFailed && "✕ Quá trình bị gián đoạn"}
              {isPaused && "⏸ Đang tạm dừng"}
              {isQueued && "⏳ Chờ worker điều phối..."}
              {isRunning && (jobState?.message || "Đang xử lý dữ liệu realtime...")}
            </span>
          </div>

          {/* Accessible Progressbar */}
          <div
            role="progressbar"
            aria-valuenow={overallProgress}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="Tiến độ xử lý AI Pipeline"
            className="w-full h-2.5 bg-[#141e33] rounded-full overflow-hidden p-0.5 border border-[#1f2d4d]"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                isCompleted
                  ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                  : isFailed
                    ? "bg-gradient-to-r from-red-600 to-amber-600"
                    : isPaused
                      ? "bg-gradient-to-r from-amber-500 to-yellow-400"
                      : "bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400"
              }`}
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* MULTI-STAGE STEPPER GRID */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 relative">
        {PIPELINE_STAGES.map((stage) => {
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
              tabIndex={0}
              aria-label={`Chặng ${stage.step}: ${stage.label} - ${stepStatus}`}
              className={`p-3 rounded-xl border transition-all duration-200 flex flex-col justify-between focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                stepStatus === "active"
                  ? "bg-blue-950/30 border-blue-500/50 shadow-md shadow-blue-500/10 ring-1 ring-blue-500/25"
                  : stepStatus === "completed"
                    ? "bg-[#0c182b] border-emerald-500/30 hover:border-emerald-500/50"
                    : stepStatus === "failed"
                      ? "bg-red-950/30 border-red-500/40 shadow-sm shadow-red-500/10"
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

                {/* Status Micro-Icon */}
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
                  {stepStatus === "active" && <SpinnerIcon />}
                  {stepStatus === "failed" && <AlertIcon />}
                  {stepStatus === "paused" && <PauseIcon />}
                  {stepStatus === "waiting" && <span className="text-xs font-bold">•</span>}
                </div>
              </div>

              {/* Stage Text Information */}
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <h4 className="text-xs font-bold text-[#f7f9ff] truncate">
                    {stage.label}
                  </h4>
                </div>
                <p className="text-[10px] text-slate-400 line-clamp-2 leading-tight">
                  {stage.title}
                </p>
              </div>

              {/* Stage Progress or Status Bottom Badge */}
              <div className="mt-2.5 pt-2 border-t border-[#18233c]/80 flex items-center justify-between text-[10px]">
                {stepStatus === "completed" && (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    ✓ Hoàn tất
                  </span>
                )}
                {stepStatus === "active" && (
                  <div className="w-full flex items-center justify-between">
                    <span className="text-blue-400 font-semibold flex items-center gap-1">
                      Đang chạy
                    </span>
                    {stagePercentage > 0 && (
                      <span className="text-cyan-300 font-mono text-[10px] font-bold">
                        {stagePercentage}%
                      </span>
                    )}
                  </div>
                )}
                {stepStatus === "failed" && (
                  <span className="text-red-400 font-semibold flex items-center gap-1">
                    Thất bại {activeErrorCode ? `(${activeErrorCode})` : ""}
                  </span>
                )}
                {stepStatus === "paused" && (
                  <span className="text-amber-400 font-semibold flex items-center gap-1">
                    Tạm dừng
                  </span>
                )}
                {stepStatus === "waiting" && (
                  <span className="text-slate-500">Chờ tới lượt</span>
                )}
                {activeRetryCount > 0 && stepStatus === "active" && (
                  <span className="text-amber-300 font-mono">Lần {activeRetryCount}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* DEGRADED CONNECTION BANNER */}
      {isDegraded && (
        <div className="mt-3 p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <RefreshCwIcon className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
            <span>
              Mất kết nối realtime WebSocket. Hệ thống đang tự động kết nối lại (Lần {reconnectAttempts}) và duy trì đồng bộ qua HTTP...
            </span>
          </div>
          <button
            type="button"
            onClick={() => syncSnapshot()}
            className="px-2 py-0.5 text-[10px] font-semibold text-amber-300 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded transition shrink-0 cursor-pointer"
          >
            Đồng bộ ngay
          </button>
        </div>
      )}

      {/* ERROR DETAIL BANNER (Zero-synthetic Failure Display) */}
      {isFailed && activeErrorMessage && (
        <div
          role="alert"
          className="mt-3 p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs flex items-start justify-between gap-3 shadow-inner"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertIcon className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
            <div className="min-w-0">
              <p className="font-bold text-red-300">
                Sự cố xử lý âm thanh {activeErrorCode ? `[${activeErrorCode}]` : ""}:
              </p>
              <p className="text-slate-300 mt-0.5 break-words">{activeErrorMessage}</p>
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              disabled={lifecycleAction}
              onClick={onRetry}
              className="shrink-0 px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg text-xs transition shadow-sm cursor-pointer disabled:opacity-50"
            >
              Thử lại ngay
            </button>
          )}
        </div>
      )}
    </section>
  );
}
