import React, { useState } from "react";
import ShareMeetingModal from "./ShareMeetingModal";

/**
 * ShareManagementInteractiveTest
 * Công cụ kiểm thử trực quan cho QA và Mentor nhằm thẩm định:
 * 1. Mở Modal ở vai trò Owner (Full quyền tạo link, revoke, đổi passcode)
 * 2. Mở Modal ở vai trò Non-Owner (Chỉ xem link, bị ẩn thao tác quản trị)
 * 3. Kiểm thử tạo link với các thời hạn khác nhau
 * 4. Kiểm thử thu hồi link với hộp thoại xác nhận (Revoke Confirmation)
 * 5. Kiểm thử Passcode Strength Meter và cơ chế không lưu plain text vào localStorage
 */
export default function ShareManagementInteractiveTest() {
  const [modalOpen, setModalOpen] = useState(false);
  const [isOwnerRole, setIsOwnerRole] = useState(true);
  const [actionLogs, setActionLogs] = useState([]);

  const mockMeeting = {
    id: "meet_demo_share_2026",
    fileName: "Sprint 4 Review & Roadmap Planning.mp4",
    title: "Sprint 4 Review & Roadmap Planning",
    isOwner: isOwnerRole,
  };

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setActionLogs((prev) => [`[${timestamp}] ${msg}`, ...prev.slice(0, 19)]);
  };

  const openAsOwner = () => {
    addLog("Kịch bản 1 (4.1): Mở Modal với tư cách Owner (Chủ cuộc họp)");
    setIsOwnerRole(true);
    setModalOpen(true);
  };

  const openAsViewer = () => {
    addLog("Kịch bản 2 (4.1): Mở Modal với tư cách Viewer (Chỉ xem - Bị chặn quản lý)");
    setIsOwnerRole(false);
    setModalOpen(true);
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 bg-[#060b17] text-white rounded-2xl border border-[#18233c] font-sans">
      <div className="mb-5 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <span>🛡️ Bảng Kiểm Thử: Modal Quản Lý Share Links & Passcode</span>
            <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">
              Sprint 4 QA
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Kiểm tra tạo/thu hồi public links, phân quyền Owner, đánh giá độ mạnh passcode và tiêu chuẩn bảo mật.
          </p>
        </div>
      </div>

      {/* BỘ NÚT ĐIỀU KHIỂN KỊCH BẢN */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="bg-[#0b1324] p-4 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-1.5">1. Kịch bản Owner (Chủ sở hữu)</h3>
          <p className="text-[11px] text-slate-400 mb-3">
            Toàn quyền tạo link, chọn thời hạn/scope, thu hồi link và thiết lập/xóa Passcode bảo vệ.
          </p>
          <button
            type="button"
            onClick={openAsOwner}
            className="w-full px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm active:scale-95"
          >
            Mở Modal với quyền Owner
          </button>
        </div>

        <div className="bg-[#0b1324] p-4 rounded-xl border border-[#1b2742]">
          <h3 className="text-xs font-bold text-slate-200 mb-1.5">2. Kịch bản Viewer / Member (Chỉ xem)</h3>
          <p className="text-[11px] text-slate-400 mb-3">
            Xác minh người dùng khác chỉ xem được danh sách link đã cấp, không thể tạo mới, thu hồi hoặc đổi Passcode.
          </p>
          <button
            type="button"
            onClick={openAsViewer}
            className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm active:scale-95"
          >
            Mở Modal với quyền Viewer (Chỉ xem)
          </button>
        </div>
      </div>

      {/* NHẬT KÝ KIỂM THỬ THỜI GIAN THỰC */}
      <div className="bg-[#080e1c] p-3.5 rounded-xl border border-[#152037]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono font-bold text-slate-400">
            Console Logs Thao Tác Share ({actionLogs.length})
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
            <p className="text-slate-600 italic">Nhấn các nút kịch bản ở trên để xem log kiểm tra thời gian thực...</p>
          ) : (
            actionLogs.map((log, idx) => (
              <div key={idx} className="leading-snug">
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* MODAL QUẢN LÝ SHARE MEETING */}
      {modalOpen && (
        <ShareMeetingModal
          meeting={mockMeeting}
          isOwner={isOwnerRole}
          onClose={() => {
            addLog("Đóng Modal Quản lý Share");
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
