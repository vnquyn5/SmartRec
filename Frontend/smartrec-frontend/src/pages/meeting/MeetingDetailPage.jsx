import React, { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MeetingDetail from "../../components/meeting/MeetingDetail";

export default function MeetingDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const meeting = location.state?.meeting;
  const [aiStatus, setAiStatus] = useState("completed");
  const [speakers, setSpeakers] = useState([
    {
      id: "1",
      originalLabel: "Speaker 1",
      name: "Anh Quyền",
      segments: [
        { start: "00:00", end: "00:15" },
        { start: "00:32", end: "00:48" },
        { start: "01:10", end: "01:25" },
      ],
    },
    {
      id: "2",
      originalLabel: "Speaker 2",
      name: "Chị Lan",
      segments: [
        { start: "00:15", end: "00:32" },
        { start: "01:25", end: "01:42" },
      ],
    },
    {
      id: "3",
      originalLabel: "Speaker 3",
      name: "Anh Hùng",
      segments: [{ start: "01:45", end: "02:10" }],
    },
    {
      id: "4",
      originalLabel: "Speaker 4",
      name: "Speaker 4",
      segments: [{ start: "02:15", end: "02:40" }],
    },
  ]);

  const handleSaveSpeakers = async (updatedSpeakers) => {
    setSpeakers((prev) =>
      prev.map((s) => {
        const match = updatedSpeakers.find((u) => u.id === s.id);
        return match ? { ...s, name: match.name } : s;
      }),
    );
  };

  return (
    <>
      <div className="w-full font-sans flex flex-col">
        {/* Page Top Header - Tối giản chuẩn Figma */}
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-[#1b2742]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/workspace")}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#141d33] border border-[#233357] text-slate-300 hover:text-white hover:bg-[#1a2642] transition shadow-sm"
              title="Quay lại"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 className="text-base font-bold text-white tracking-wide">
              {meeting?.fileName || meeting?.title || "Q4_Planning_Session_Final.mp4"}
            </h1>
          </div>
          
          {/* Avatar User */}
          <div className="w-8 h-8 rounded-full overflow-hidden border border-[#38bdf8] shadow-sm">
             <img src="https://i.pravatar.cc/100?img=11" alt="User Avatar" className="w-full h-full object-cover" />
          </div>
        </div>

        {/* Meeting Detail Component */}
        <MeetingDetail
          fileType={
            meeting?.fileType ||
            (meeting?.fileName?.toLowerCase().endsWith(".mp3")
              ? "audio"
              : "video")
          }
          speakers={aiStatus === "empty" ? [] : speakers}
          onSaveSpeakers={handleSaveSpeakers}
        />
      </div>
    </>
  );
}
