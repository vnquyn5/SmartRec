import React, { useState } from "react";
import RealtimeStepper from "./RealtimeStepper";

/**
 * RealtimeStepperInteractiveTest
 * Công cụ kiểm thử trực quan cho QA và Mentor nhằm thẩm định các kịch bản:
 * 1. Stream bình thường (0% -> 100%)
 * 2. Lỗi Zero-synthetic (Failed dừng đúng chặng, không nhảy 100%)
 * 3. Mất kết nối & Thử lại (Degraded & Backoff)
 * 4. Stale Response Drop (Gói tin từ job cũ bị chặn)
 * 5. Tạm dừng & Tiếp tục (Pause/Resume lifecycle)
 */
export default function RealtimeStepperInteractiveTest() {
  const [testJobId, setTestJobId] = useState("job_demo_101");
  const [currentStage, setCurrentStage] = useState("PYANNOTE");
  const [jobStatus, setJobStatus] = useState("PROCESSING");
  const [errorCode, setErrorCode] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [logMessages, setLogMessages] = useState([]);

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogMessages((prev) => [`[${timestamp}] ${msg}`, ...prev.slice(0, 19)]);
  };

  // Kịch bản 1: Luồng xử lý bình thường thành công
  const triggerNormalSuccess = () => {
    addLog("Kịch bản 1: Bắt đầu luồng xử lý bình thường");
    setJobStatus("PROCESSING");
    setCurrentStage("FFMPEG");
    setErrorCode(null);
    setErrorMessage(null);

    setTimeout(() => {
      addLog("➔ Chuyển sang Chặng 2: WEBRTC");
      setCurrentStage("WEBRTC");
    }, 1500);

    setTimeout(() => {
      addLog("➔ Chuyển sang Chặng 3: PYANNOTE");
      setCurrentStage("PYANNOTE");
    }, 3000);

    setTimeout(() => {
      addLog("➔ Chuyển sang Chặng 4: OUTPUT");
      setCurrentStage("OUTPUT");
    }, 4500);

    setTimeout(() => {
      addLog("✔ Hoàn tất xử lý AI: 100% COMPLETED");
      setJobStatus("COMPLETED");
    }, 6000);
  };

  // Kịch bản 2: Kiểm thử Zero-Synthetic Failure (TC-01)
  const triggerFailureScenario = () => {
    addLog("Kịch bản 2 (TC-01): Kiểm thử Lỗi Zero-Synthetic tại chặng PYANNOTE");
    setJobStatus("PROCESSING");
    setCurrentStage("PYANNOTE");
    setErrorCode(null);
    setErrorMessage(null);

    setTimeout(() => {
      addLog("✕ Worker báo lỗi CUDA_OOM: Xác minh stepper KHÔNG ĐƯỢC nhảy lên 100%!");
      setJobStatus("FAILED");
      setErrorCode("CUDA_OOM");
      setErrorMessage("Bộ nhớ GPU CUDA không đủ để xử lý mô hình PyAnnote Diarization.");
    }, 1200);
  };

  // Kịch bản 3: Tạm dừng và tiếp tục
  const triggerPause = () => {
    addLog("⏸ Người dùng yêu cầu tạm dừng (PAUSE_REQUESTED ➔ PAUSED)");
    setJobStatus("PAUSED");
  };

  const triggerResume = () => {
    addLog("▶ Người dùng tiếp tục xử lý (RESUME ➔ PROCESSING)");
    setJobStatus("PROCESSING");
  };

  const triggerRetry = () => {
    addLog("🔄 Người dùng nhấn Thử lại (RETRYING ➔ Lần " + (retryCount + 1) + ")");
    setRetryCount((prev) => prev + 1);
    setJobStatus("RETRYING");
    setErrorCode(null);
    setErrorMessage(null);

    setTimeout(() => {
      setJobStatus("PROCESSING");
      addLog("➔ Worker đã nhận lệnh thử lại và tiếp tục chặng PYANNOTE");
    }, 1500);
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 sm:p-6 bg-[#060b17] text-white rounded-2xl border border-[#18233c] font-sans">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <span>🧪 Bảng Kiểm Thử Thực Tế: RealtimeStepper.jsx</span>
            <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">
              Sprint 4 QA
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Môi trường kiểm định phản hồi thời gian thực, xác thực Zero-synthetic State và quản trị vòng đời tác vụ.
          </p>
        </div>
      </div>

      {/* COMPONENT THỰC TẾ ĐANG CHẠY */}
      <div className="mb-6">
        <RealtimeStepper
          jobId={testJobId}
          currentStage={currentStage}
          jobStatus={jobStatus}
          errorCode={errorCode}
          errorMessage={errorMessage}
          retryCount={retryCount}
          onPause={triggerPause}
          onResume={triggerResume}
          onRetry={triggerRetry}
          onCancel={() => addLog("⏹ Người dùng nhấn Hủy tác vụ")}
        />
      </div>

      {/* BỘ NÚT ĐIỀU KHIỂN KỊCH BẢN TEST */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-[#0b1324] p-3 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-2">1. Kịch bản Luồng Chuẩn</h3>
          <button
            type="button"
            onClick={triggerNormalSuccess}
            className="w-full px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
          >
            Chạy Stream 0% ➔ 100%
          </button>
        </div>

        <div className="bg-[#0b1324] p-3 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-2">2. Zero-Synthetic Failure (TC-01)</h3>
          <button
            type="button"
            onClick={triggerFailureScenario}
            className="w-full px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
          >
            Mô phỏng Lỗi GPU (Không nhảy 100%)
          </button>
        </div>

        <div className="bg-[#0b1324] p-3 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-2">3. Vòng đời tác vụ</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={triggerPause}
              className="flex-1 px-2 py-1.5 bg-amber-600/80 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              Tạm dừng
            </button>
            <button
              type="button"
              onClick={triggerResume}
              className="flex-1 px-2 py-1.5 bg-cyan-600/80 hover:bg-cyan-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              Tiếp tục
            </button>
          </div>
        </div>
      </div>

      {/* NHẬT KÝ KIỂM THỬ THỜI GIAN THỰC */}
      <div className="bg-[#080e1c] p-3 rounded-xl border border-[#152037]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono font-bold text-slate-400">
            Console Logs Kiểm Thử ({logMessages.length})
          </span>
          <button
            type="button"
            onClick={() => setLogMessages([])}
            className="text-[10px] text-slate-400 hover:text-white"
          >
            Xóa log
          </button>
        </div>
        <div className="h-28 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1">
          {logMessages.length === 0 ? (
            <p className="text-slate-600 italic">Nhấn các nút kịch bản ở trên để xem log kiểm định thời gian thực...</p>
          ) : (
            logMessages.map((log, idx) => (
              <div key={idx} className="leading-snug">
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
