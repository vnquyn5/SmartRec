import React, { useState, useRef, useEffect } from 'react';
import mockSummaryData from '../../mocks/mock_summary.json';
import { getGovernanceSnapshotSync } from '../../services/modelGovernanceService';

function resolveInitialModelLabel() {
  const snapshot = getGovernanceSnapshotSync();
  const activeKey = snapshot?.policy?.activeModels?.['LLM Summary'] || '';
  if (/gemini/i.test(activeKey)) return 'Gemini';
  return 'Local Qwen';
}

export default function AiUsageBadge() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(resolveInitialModelLabel);
  const [governanceSnapshot, setGovernanceSnapshot] = useState(() =>
    getGovernanceSnapshotSync()
  );
  const badgeRef = useRef(null);

  const activeLlmKey = governanceSnapshot?.policy?.activeModels?.['LLM Summary'] || '';
  const activeLlmName = activeLlmKey.split('@')[0] || 'Qwen 2.5 7B-Instruct';
  const fallbackEnabled = Boolean(
    governanceSnapshot?.policy?.geminiFallbackEnabled ??
      governanceSnapshot?.policy?.autoFallback ??
      true
  );
  const fallbackModel =
    governanceSnapshot?.policy?.geminiFallbackModel || 'gemini-2.5-flash';

  const aiData = mockSummaryData?.ai_usage || {
    model_name: selectedModel === 'Local Qwen' ? activeLlmName : fallbackModel,
    total_tokens: selectedModel === 'Local Qwen' ? 1850 : 2100,
    prompt_tokens: selectedModel === 'Local Qwen' ? 1420 : 1600,
    completion_tokens: selectedModel === 'Local Qwen' ? 430 : 500,
  };

  const toggleModel = (e) => {
    e.stopPropagation();
    setSelectedModel((prev) => (prev === 'Local Qwen' ? 'Gemini' : 'Local Qwen'));
  };

  // Tự động đóng popover khi click ra ngoài và đồng bộ khi mở lại
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (badgeRef.current && !badgeRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setGovernanceSnapshot(getGovernanceSnapshotSync());
    }
  }, [isOpen]);

  return (
    <div ref={badgeRef} className="relative inline-block text-left select-none">
      {/* Nút Badge - Bấm vào để Mở / Đóng popover */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-full border transition-all cursor-pointer shadow-md ${
          isOpen
            ? 'bg-[#142342] border-[#38bdf8] ring-1 ring-[#38bdf8]/40'
            : 'bg-[#0b1426] border-[#20365e] hover:border-[#38bdf8]'
        }`}
      >
        {/* Chấm trạng thái AI hoạt động */}
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>

        {/* Tên Model */}
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
          <span className="text-slate-400">Model:</span>
          <span className="text-[#38bdf8] font-mono">{selectedModel}</span>
        </div>

        <span className="text-slate-600">|</span>

        {/* Tokens Badge */}
        <div className="flex items-center gap-1 text-[11px]">
          <span className="text-slate-400">Tokens:</span>
          <span className="font-mono font-bold text-amber-400">
            {aiData.total_tokens.toLocaleString()}
          </span>
        </div>

        {/* Mũi tên chỉ thị mở/đóng */}
        <svg
          className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-[#38bdf8]' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Popover Chi tiết khi đã Bấm mở */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-[#0a1122] border border-[#1b2b4d] rounded-xl p-3.5 shadow-2xl z-50 text-xs text-slate-300 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-[#172542]">
            <span className="font-bold text-white flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              AI Engine &amp; Token Usage
            </span>
            <button
              type="button"
              onClick={toggleModel}
              className="text-[10px] bg-[#142340] hover:bg-[#1d3563] text-[#38bdf8] px-2 py-0.5 rounded border border-[#233b6b] transition active:scale-95"
              title="Chuyển đổi xem trước giữa Local Qwen và Gemini"
            >
              Đổi sang {selectedModel === 'Local Qwen' ? 'Gemini' : 'Local Qwen'}
            </button>
          </div>

          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Active LLM (Governance):</span>
              <span className="font-mono text-white font-medium truncate">
                {selectedModel === 'Local Qwen' ? activeLlmName : fallbackModel}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Chế độ vận hành:</span>
              <span className={selectedModel === 'Local Qwen' ? 'text-emerald-400 font-medium' : 'text-sky-400 font-medium'}>
                {selectedModel === 'Local Qwen' ? '100% Local Private' : 'Google Cloud API'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Gemini Fallback:</span>
              <span className={fallbackEnabled ? 'text-amber-300 font-semibold' : 'text-slate-400'}>
                {fallbackEnabled ? `ON (${fallbackModel})` : 'OFF'}
              </span>
            </div>

            <div className="pt-2 border-t border-[#172542] space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Prompt Tokens:</span>
                <span className="font-mono text-slate-200">{aiData.prompt_tokens}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Completion Tokens:</span>
                <span className="font-mono text-slate-200">{aiData.completion_tokens}</span>
              </div>
              <div className="flex justify-between font-semibold pt-1 border-t border-[#131d33] text-white">
                <span>Tổng Tokens:</span>
                <span className="font-mono text-amber-400">{aiData.total_tokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Chi phí ước tính:</span>
                <span className="font-mono text-emerald-400">
                  {selectedModel === 'Local Qwen' ? '$0.00 (Local)' : '~$0.0007'}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-[#172542] flex items-center justify-between">
              <a
                href="/governance?tab=usage"
                className="text-[11px] font-semibold text-[#38bdf8] hover:text-white transition"
              >
                Mở AI Usage Dashboard →
              </a>
              <a
                href="/governance?tab=models"
                className="text-[11px] text-slate-400 hover:text-slate-200 transition"
              >
                Governance
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
