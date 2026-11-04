import React from 'react';

export default function MeetingSummaryTab({ summary, llmStatus, loading = false, error = '' }) {
  return (
    <div className="w-full flex flex-col gap-5 text-slate-300">
      <div className="pb-3 border-b border-[#1b2640]">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
          Tóm tắt cuộc họp (AI Executive Summary)
        </h3>
        <p className="text-xs text-slate-400 mt-1 pl-3.5">Kết quả được đọc từ Backend của cuộc họp này.</p>
      </div>

      <div className="bg-[#0d1526] border border-[#1b2742] rounded-2xl p-5 text-sm leading-relaxed min-h-28">
        {loading && <p className="text-slate-400">Đang tải kết quả…</p>}
        {!loading && error && <p role="alert" className="text-amber-200">{error}</p>}
        {!loading && !error && summary?.executiveSummary && (
          <p className="whitespace-pre-wrap text-slate-200">{summary.executiveSummary}</p>
        )}
        {!loading && !error && !summary?.executiveSummary && llmStatus === 'NOT_PROCESSED' && (
          <p className="text-slate-300">Chưa xử lý AI. Transcript và OCR vẫn có thể được xem trong các tab tương ứng.</p>
        )}
        {!loading && !error && !summary?.executiveSummary && llmStatus !== 'NOT_PROCESSED' && (
          <p className="text-slate-400">Chưa có tóm tắt hợp lệ được lưu cho cuộc họp này.</p>
        )}
      </div>
    </div>
  );
}
