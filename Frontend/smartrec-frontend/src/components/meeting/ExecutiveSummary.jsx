import React, { useState } from 'react';
import mockSummaryData from '../../mocks/mock_summary.json';

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
            Kết luận & Tóm tắt điều hành (Executive Summary)
          </h3>
          <p className="text-xs text-slate-400 mt-1 pl-3.5">
            Tổng hợp tự động: Kết luận cuộc họp, Mục tiêu & Quyết định chiến lược
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopySummary}
          className="text-xs text-[#38bdf8] hover:text-white bg-[#142340] hover:bg-[#1d3563] px-3 py-1.5 rounded-lg border border-[#233b6b] transition flex items-center gap-1.5"
        >
          {copied ? '✓ Đã sao chép' : 'Sao chép tóm tắt'}
        </button>
      </div>

      {/* Danh sách các phần tóm tắt từ mock_summary.json */}
      <div className="bg-[#0d1526] border border-[#1b2742] rounded-2xl p-5 space-y-5 text-xs leading-relaxed shadow-lg">
        {summaryList.map((item, index) => (
          <div key={index} className="space-y-1.5 border-b border-[#16223b] pb-4 last:border-b-0 last:pb-0">
            <h4 className="font-bold text-sm text-[#38bdf8] capitalize flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#38bdf8]/60"></span>
              {item.heading}
            </h4>
            <p className="text-slate-300 pl-4 leading-relaxed text-[13px]">
              {item.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

