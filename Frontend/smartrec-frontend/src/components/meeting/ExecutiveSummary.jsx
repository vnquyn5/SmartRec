import React, { useState } from 'react';
import mockSummaryData from '../../mocks/mock_summary.json';

const TYPE_CONFIG = {
  objective: {
    badge: 'Mục tiêu',
    badgeClass: 'bg-blue-950/60 text-blue-400 border-blue-800/50',
    icon: '🎯'
  },
  decision: {
    badge: 'Quyết định',
    badgeClass: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50',
    icon: '💡'
  },
  conclusion: {
    badge: 'Kết luận',
    badgeClass: 'bg-purple-950/60 text-purple-400 border-purple-800/50',
    icon: '🏁'
  },
  discussion: {
    badge: 'Thảo luận',
    badgeClass: 'bg-amber-950/60 text-amber-400 border-amber-800/50',
    icon: '📋'
  }
};

function resolveTypeConfig(item, index) {
  if (item?.type && TYPE_CONFIG[item.type]) {
    return TYPE_CONFIG[item.type];
  }
  const heading = (item?.heading || '').toLowerCase();
  if (heading.includes('muc tieu') || heading.includes('mục tiêu') || index === 0) {
    return TYPE_CONFIG.objective;
  }
  if (
    heading.includes('quyet dinh') ||
    heading.includes('quyết định') ||
    heading.includes('san pham') ||
    heading.includes('tinh nang') ||
    index === 1
  ) {
    return TYPE_CONFIG.decision;
  }
  if (
    heading.includes('ket luan') ||
    heading.includes('kết luận') ||
    heading.includes('loi ich') ||
    index === 2
  ) {
    return TYPE_CONFIG.conclusion;
  }
  return TYPE_CONFIG.discussion;
}

export default function ExecutiveSummary() {
  const summaryList = mockSummaryData?.summary || [];
  const [copied, setCopied] = useState(false);

  const handleCopySummary = () => {
    const fullText = summaryList
      .map((item) => `${item.heading}\n${item.content}`)
      .join('\n\n');
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full flex flex-col gap-5 text-slate-300">
      {/* Header Summary */}
      <div className="flex items-center justify-between pb-3 border-b border-[#1b2640]">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block"></span>
            Kết luận Cuộc họp & Tóm tắt điều hành (Executive Summary)
          </h3>
          <p className="text-xs text-slate-400 mt-1 pl-3.5">
            Tổng hợp tự động: Kết luận cuộc họp, Mục tiêu & Quyết định chiến lược
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopySummary}
          className="text-xs text-[#38bdf8] hover:text-white bg-[#142340] hover:bg-[#1d3563] px-3 py-1.5 rounded-lg border border-[#233b6b] transition flex items-center gap-1.5 self-start sm:self-auto shadow-sm"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Đã sao chép</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span>Sao chép tóm tắt</span>
            </>
          )}
        </button>
      </div>

      {/* Cards danh sách Kết luận, Mục tiêu & Quyết định */}
      <div className="space-y-4">
        {summaryList.map((item, index) => {
          const config = resolveTypeConfig(item, index);
          return (
            <div
              key={index}
              className="bg-[#0d1526] border border-[#1b2742] rounded-xl p-4 transition-all hover:border-[#2b3e68] shadow-md flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-semibold text-sm text-white flex items-center gap-2 capitalize">
                  <span>{config.icon}</span>
                  <span className="text-[#38bdf8]">{item.heading}</span>
                </h4>
                <span className={`text-[11px] px-2 py-0.5 rounded-md border font-medium shrink-0 ${config.badgeClass}`}>
                  {config.badge}
                </span>
              </div>
              <p className="text-slate-300 text-xs sm:text-[13px] leading-relaxed pl-6">
                {item.content}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}