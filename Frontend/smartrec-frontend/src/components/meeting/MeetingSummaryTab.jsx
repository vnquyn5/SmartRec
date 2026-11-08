import React from 'react';
import EvidenceReferences from './EvidenceReferences';
import { evidenceReferences, getSummaryViewState } from './meetingResults';

const sections = [
  ['Decisions', 'decisions', 'Chưa xác định được quyết định đã xác nhận từ transcript.'],
  ['Key Points', 'keyPoints', 'Chưa có điểm chính đủ bằng chứng để ghi nhận.'],
  ['Open Issues', 'openIssues', 'Không có nội dung nào cần xem lại theo bằng chứng hiện có.'],
  ['Next Steps', 'nextSteps', 'Chưa có bước tiếp theo đủ bằng chứng để ghi nhận.'],
];

function EvidenceList({ title, items, emptyMessage, transcripts, onEvidenceClick }) {
  return (
    <section className="rounded-xl border border-[#1b2742] bg-[#0d1526] p-4">
      <h4 className="text-xs font-bold uppercase tracking-wide text-[#38bdf8]">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{emptyMessage}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {items.map((item, index) => {
            const refs = evidenceReferences(item);
            return (
              <li key={`${item.text || 'item'}-${index}`} className="text-xs leading-relaxed text-slate-300">
                <p>{item.text || String(item)}</p>
                {item.kind && <span className="mt-1 inline-block text-[10px] text-slate-500">{item.kind}</span>}
                <EvidenceReferences references={refs} transcripts={transcripts} onNavigate={onEvidenceClick} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function MeetingSummaryTab({ summary, llmProvider = null, fallbackUsed = false, transcripts = [], onEvidenceClick, aiStatus = 'processing', loading = false, error = '' }) {
  const viewState = getSummaryViewState({ summary, aiStatus, loading, error });

  return (
    <div className="w-full min-w-0 flex flex-col gap-4 text-slate-300">
      <header className="pb-3 border-b border-[#1b2640]">
        <h3 className="text-sm font-bold text-white">AI Summary</h3>
        {viewState === 'success' && llmProvider && (
          <p className="mt-1 text-xs text-slate-400">
            Nguồn AI: {llmProvider}{fallbackUsed ? ' (dự phòng)' : ''}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-400">Tóm tắt và các nội dung được hỗ trợ bởi bằng chứng cuộc họp.</p>
      </header>

      {viewState === 'error' ? (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-5 text-sm text-amber-200">{error}</p>
      ) : viewState === 'loading' ? (
        <p role="status" className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Đang tải kết quả AI…</p>
      ) : viewState === 'success' ? (
        <>
          <section className="rounded-xl border border-[#1b2742] bg-[#0d1526] p-4">
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#38bdf8]">Executive Summary</h4>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{summary.executiveSummary}</p>
            <EvidenceReferences references={summary.executiveSummaryRefs} transcripts={transcripts} onNavigate={onEvidenceClick} />
          </section>
          <div className="grid grid-cols-1 gap-3">
            {sections.map(([title, key, emptyMessage]) => (
              <EvidenceList key={key} title={title} items={summary[key] || []} emptyMessage={emptyMessage} transcripts={transcripts} onEvidenceClick={onEvidenceClick} />
            ))}
          </div>
        </>
      ) : viewState === 'processing' ? (
        <p role="status" className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Đang xử lý. AI Summary sẽ xuất hiện khi có kết quả.</p>
      ) : viewState === 'failed' ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-4 py-5 text-sm text-rose-200">Xử lý cuộc họp thất bại; không có AI Summary khả dụng.</p>
      ) : viewState === 'enrichment_failed' ? (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-5 text-sm text-amber-200">Xử lý transcript đã hoàn tất nhưng AI Summary không tạo được. Transcript vẫn khả dụng.</p>
      ) : viewState === 'enrichment_disabled' ? (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-5 text-sm text-amber-200">Xử lý transcript đã hoàn tất nhưng AI Summary đang bị tắt. Transcript vẫn khả dụng.</p>
      ) : viewState === 'unprocessed' ? (
        <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Cuộc họp chưa được xử lý.</p>
      ) : (
        <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Xử lý âm thanh đã kết thúc nhưng AI Summary chưa khả dụng.</p>
      )}
    </div>
  );
}
