import React from 'react';

export default function MeetingSummaryTab({ analysis }) {
  const summary = analysis?.summary?.trim();
  const decisions = analysis?.keyDecisions || [];
  return (
    <div className="w-full flex flex-col gap-5 text-slate-300">
      <div className="pb-3 border-b border-[#1b2640]">
        <h3 className="text-sm font-bold text-white">Tóm tắt cuộc họp</h3>
        <p className="text-xs text-slate-400 mt-1">Qwen local · kết quả từ cuộc họp này</p>
      </div>
      {!analysis ? <p className="text-sm text-slate-400">Chưa có kết quả phân tích cho cuộc họp.</p> : (
        <div className="bg-[#0d1526] border border-[#1b2742] rounded-2xl p-5 space-y-5 text-sm leading-relaxed">
          <section>
            <h4 className="font-bold text-[#38bdf8] mb-2">Tóm tắt</h4>
            <p className="whitespace-pre-wrap">{summary || 'Không có nội dung tóm tắt.'}</p>
          </section>
          <section>
            <h4 className="font-bold text-[#38bdf8] mb-2">Quyết định</h4>
            {decisions.length ? <ul className="list-disc pl-5 space-y-1">{decisions.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul> : <p className="text-slate-400">Chưa trích xuất được quyết định.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
