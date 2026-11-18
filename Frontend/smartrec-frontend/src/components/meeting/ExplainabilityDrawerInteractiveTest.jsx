import React, { useState } from "react";
import ExplainabilityDrawer from "./ExplainabilityDrawer";
import mockExplainabilityData from "../../mocks/mock_explainability.json";

/**
 * ExplainabilityDrawerInteractiveTest
 * Công cụ kiểm thử trực quan cho QA và Mentor để thẩm định:
 * 1. Mở minh chứng từ Task Matrix (Audio + Slide OCR)
 * 2. Mở minh chứng từ Executive Summary
 * 3. Luật Audio-only Guard (Ẩn hoàn toàn Slide khi tệp là audio)
 * 4. Cảnh báo Heuristic Confidence chưa hiệu chuẩn (TR01)
 * 5. Xử lý Truy cập bị từ chối (403 Forbidden)
 * 6. Xử lý Minh chứng không tồn tại / Đã bị xóa (BR03)
 */
export default function ExplainabilityDrawerInteractiveTest() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentEvidence, setCurrentEvidence] = useState(null);
  const [fileType, setFileType] = useState("video");
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [actionLogs, setActionLogs] = useState([]);

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setActionLogs((prev) => [`[${timestamp}] ${msg}`, ...prev.slice(0, 19)]);
  };

  // Kịch bản 1: Mở Task 1 (Video: có cả Audio và Slide)
  const openTask1Video = () => {
    addLog("Kịch bản 1: Mở Minh chứng Task #1 (Video mode: Audio + Slide OCR)");
    setIsPermissionDenied(false);
    setIsDeleted(false);
    setFileType("video");
    setCurrentEvidence(mockExplainabilityData.evidence_by_task_index["1"]);
    setDrawerOpen(true);
  };

  // Kịch bản 2: Mở Task 1 nhưng chế độ Audio-only (TC-02: Bắt buộc ẩn Slide)
  const openTask1AudioOnly = () => {
    addLog("Kịch bản 2 (TC-02): Mở Minh chứng Task #1 (Audio-only: BẮT BUỘC ẨN SLIDE)");
    setIsPermissionDenied(false);
    setIsDeleted(false);
    setFileType("audio");
    setCurrentEvidence(mockExplainabilityData.evidence_by_task_index["1"]);
    setDrawerOpen(true);
  };

  // Kịch bản 3: Mở AI Summary 1
  const openSummary1 = () => {
    addLog("Kịch bản 3 (BR01): Mở Minh chứng Tóm tắt mục tiêu Q4");
    setIsPermissionDenied(false);
    setIsDeleted(false);
    setFileType("video");
    setCurrentEvidence(mockExplainabilityData.evidence_by_summary_index["1"]);
    setDrawerOpen(true);
  };

  // Kịch bản 4: Quyền truy cập bị từ chối (403)
  const openPermissionDenied = () => {
    addLog("Kịch bản 4: Kiểm thử Quyền truy cập bị từ chối (403 Forbidden)");
    setCurrentEvidence(null);
    setIsDeleted(false);
    setIsPermissionDenied(true);
    setDrawerOpen(true);
  };

  // Kịch bản 5: Minh chứng không tồn tại / Đã bị xóa (BR03)
  const openDeletedArtifact = () => {
    addLog("Kịch bản 5 (BR03): Kiểm thử Artifact đã bị xóa / Trống dữ liệu");
    setCurrentEvidence(null);
    setIsPermissionDenied(false);
    setIsDeleted(true);
    setDrawerOpen(true);
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 sm:p-6 bg-[#060b17] text-white rounded-2xl border border-[#18233c] font-sans">
      <div className="mb-5 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <span>🔍 Bảng Kiểm Thử Thực Tế: ExplainabilityDrawer.jsx</span>
            <span className="text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
              Sprint 4 QA
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Kiểm định minh chứng trích xuất AI (Grounding), phân loại nguồn (Audio & Slide OCR), và kiểm thử các kịch bản biên bảo mật.
          </p>
        </div>
      </div>

      {/* BỘ NÚT ĐIỀU KHIỂN KỊCH BẢN TEST */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mb-5">
        <div className="bg-[#0b1324] p-3.5 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-2">1. Minh Chứng Đa Nguồn (Video)</h3>
          <button
            type="button"
            onClick={openTask1Video}
            className="w-full px-3 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm active:scale-95"
          >
            Mở Task #1 (Audio + Slide OCR)
          </button>
        </div>

        <div className="bg-[#0b1324] p-3.5 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-2">2. Audio-only Guard (TC-02)</h3>
          <button
            type="button"
            onClick={openTask1AudioOnly}
            className="w-full px-3 py-2 bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm active:scale-95"
          >
            Mở Audio-only (Ẩn Slide Keyframe)
          </button>
        </div>

        <div className="bg-[#0b1324] p-3.5 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-2">3. Minh Chứng AI Summary</h3>
          <button
            type="button"
            onClick={openSummary1}
            className="w-full px-3 py-2 bg-emerald-600/80 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm active:scale-95"
          >
            Mở Summary #1 (Mục tiêu Q4)
          </button>
        </div>

        <div className="bg-[#0b1324] p-3.5 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-2">4. Bảo mật Phân Quyền (403)</h3>
          <button
            type="button"
            onClick={openPermissionDenied}
            className="w-full px-3 py-2 bg-rose-600/80 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm active:scale-95"
          >
            Mô phỏng Permission Denied
          </button>
        </div>

        <div className="bg-[#0b1324] p-3.5 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-2">5. Artifact Bị Xóa (BR03)</h3>
          <button
            type="button"
            onClick={openDeletedArtifact}
            className="w-full px-3 py-2 bg-amber-600/80 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm active:scale-95"
          >
            Mô phỏng Minh chứng đã bị xóa
          </button>
        </div>

        <div className="bg-[#0b1324] p-3.5 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-2">6. Trạng thái Drawer Hiện Tại</h3>
          <div className="text-xs text-slate-300 space-y-1">
            <p>Trạng thái: <strong className={drawerOpen ? "text-emerald-400" : "text-slate-400"}>{drawerOpen ? "Đang Mở (Open)" : "Đã Đóng (Closed)"}</strong></p>
            <p>Loại tệp: <strong className="text-cyan-300 font-mono">{fileType}</strong></p>
          </div>
        </div>
      </div>

      {/* NHẬT KÝ THAO TÁC THỜI GIAN THỰC */}
      <div className="bg-[#080e1c] p-3.5 rounded-xl border border-[#152037]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono font-bold text-slate-400">
            Console Logs Thao Tác Seek & Events ({actionLogs.length})
          </span>
          <button
            type="button"
            onClick={() => setActionLogs([])}
            className="text-[10px] text-slate-400 hover:text-white"
          >
            Xóa log
          </button>
        </div>
        <div className="h-32 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1">
          {actionLogs.length === 0 ? (
            <p className="text-slate-600 italic">Nhấn các nút kịch bản ở trên để xem log kiểm định thời gian thực...</p>
          ) : (
            actionLogs.map((log, idx) => (
              <div key={idx} className="leading-snug">
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* COMPONENT EXPLAINABILITY DRAWER */}
      <ExplainabilityDrawer
        isOpen={drawerOpen}
        evidence={currentEvidence}
        fileType={fileType}
        isPermissionDenied={isPermissionDenied}
        isDeleted={isDeleted}
        onClose={() => {
          addLog("Drawer được đóng lại bởi người dùng (onClose)");
          setDrawerOpen(false);
        }}
        onSeekMedia={(seconds) => {
          addLog(`▶ Kích hoạt onSeekMedia: Nhảy đến giây thứ ${seconds}s`);
        }}
        onSeekSlide={(seconds) => {
          addLog(`🔍 Kích hoạt onSeekSlide: Nhảy đến Slide tại giây thứ ${seconds}s`);
        }}
      />
    </div>
  );
}
