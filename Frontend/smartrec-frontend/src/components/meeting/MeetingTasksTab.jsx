import React from 'react';
import EvidenceReferences from './EvidenceReferences';
import { formatActionDeadline, getTasksViewState } from './meetingResults';

export default function MeetingTasksTab({ tasks = [], transcripts = [], onEvidenceClick, hasSummary = false, aiStatus = 'processing', loading = false, error = '' }) {
  const viewState = getTasksViewState({ tasks, hasSummary, aiStatus, loading, error });

  return (
    <div className="w-full min-w-0 flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3 border-b border-[#1b2640] pb-3">
        <div>
          <h3 className="text-sm font-bold text-white">Action Items</h3>
          <p className="mt-1 text-xs text-slate-400">Nhiệm vụ được trích xuất từ kết quả AI của cuộc họp.</p>
        </div>
        <span className="shrink-0 rounded-full border border-[#233863] bg-[#182642] px-2.5 py-1 text-xs font-semibold text-[#38bdf8]">
          {tasks.length}
        </span>
      </header>

      {viewState === 'error' ? (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-5 text-sm text-amber-200">{error}</p>
      ) : viewState === 'loading' ? (
        <p role="status" className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Đang tải nhiệm vụ…</p>
      ) : viewState === 'success' ? (
        <ul className="flex flex-col gap-3">
          {tasks.map((task, index) => {
            const refs = task.sourceRefs?.length
              ? task.sourceRefs
              : task.sourceTranscriptId ? [`TRANSCRIPT:${task.sourceTranscriptId}`] : [];
            return (
              <li key={task.id} className="rounded-2xl border border-[#1b2742] bg-[#0d1526] p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-sm font-semibold leading-relaxed text-slate-100">{index + 1}. {task.title}</h4>
                  <span className="shrink-0 rounded-full border border-[#263653] bg-[#111b30] px-2 py-1 text-[10px] font-semibold text-slate-300">
                    {task.status || 'OPEN'}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-500">Người phụ trách</dt>
                    <dd className="mt-1 text-slate-300">{task.assigneeName || 'Chưa xác định'}</dd>
                    {task.assigneeName && task.assignmentProvenance === 'FIRST_PERSON_COMMITMENT' && (
                      <dd className="mt-1 text-[10px] text-sky-300">Cam kết được liên kết với người nói trong transcript</dd>
                    )}
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-500">Hạn chót</dt>
                    <dd className="mt-1 text-slate-300">{formatActionDeadline(task) || 'Chưa có hạn chót'}</dd>
                  </div>
                </dl>
                <EvidenceReferences references={refs} transcripts={transcripts} onNavigate={onEvidenceClick} />
              </li>
            );
          })}
        </ul>
      ) : viewState === 'processing' ? (
        <p role="status" className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Đang xử lý. Nhiệm vụ sẽ xuất hiện khi có kết quả AI.</p>
      ) : viewState === 'failed' ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-4 py-5 text-sm text-rose-200">Xử lý cuộc họp thất bại; không có nhiệm vụ AI khả dụng.</p>
      ) : viewState === 'enrichment_failed' ? (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-5 text-sm text-amber-200">Xử lý transcript đã hoàn tất nhưng AI Action Items không tạo được. Transcript vẫn khả dụng.</p>
      ) : viewState === 'enrichment_disabled' ? (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-5 text-sm text-amber-200">Xử lý transcript đã hoàn tất nhưng AI Action Items đang bị tắt. Transcript vẫn khả dụng.</p>
      ) : viewState === 'unprocessed' ? (
        <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Cuộc họp chưa được xử lý.</p>
      ) : viewState === 'empty' ? (
        <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Không có action items được lưu cho cuộc họp.</p>
      ) : viewState === 'unavailable' ? (
        <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Xử lý âm thanh đã kết thúc nhưng AI action items chưa khả dụng.</p>
      ) : (
        <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-4 py-5 text-sm text-slate-400">Chưa có action items.</p>
      )}
    </div>
  );
}
