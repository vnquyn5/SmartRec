import React, { useState } from 'react';

export default function AiUsageBadge({ modelName = "Local Whisper + Llama 3" }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="relative inline-block">
      {/* Badge thu nhỏ */}
      <div
        onMouseEnter={() => setShowDetail(true)}
        onMouseLeave={() => setShowDetail(false)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0b1426] border border-[#20365e] shadow-md hover:border-[#38bdf8] transition-all cursor-pointer select-none"
      >
        {/* Chấm trạng thái AI hoạt động */}
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>

        {/* Icon AI Chip */}
        <svg className="w-3.5 h-3.5 text-[#38bdf8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" />
          <line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" />
          <line x1="15" y1="20" x2="15" y2="23" />
          <line x1="20" y1="9" x2="23" y2="9" />
          <line x1="20" y1="14" x2="23" y2="14" />
          <line x1="1" y1="9" x2="4" y2="9" />
          <line x1="1" y1="14" x2="4" y2="14" />
        </svg>

        <span className="text-[11px] font-semibold text-slate-300">
          Model: <span className="text-[#38bdf8] font-mono">{modelName}</span>
        </span>
      </div>

      {/* Tooltip hiển thị thông số chi tiết khi hover */}
      {showDetail && (
        <div className="absolute right-0 bottom-full mb-2 w-64 bg-[#0a1122] border border-[#1b2b4d] rounded-xl p-3 shadow-2xl z-50 text-xs text-slate-300 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#172542]">
            <span className="font-bold text-white flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              AI Processing Engine
            </span>
            <span className="text-[10px] bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-800/40">
              Active
            </span>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">STT Engine:</span>
              <span className="font-mono text-slate-200">Whisper-Large-v3</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Summary LLM:</span>
              <span className="font-mono text-[#38bdf8]">Llama-3-8B-Instruct</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Environment:</span>
              <span className="text-emerald-400 font-medium">100% Local Private</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

