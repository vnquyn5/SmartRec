import React from 'react';

export default function MeetingTasksTab({ tasks = [], llmStatus, loading = false, error = '' }) {
  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex items-center justify-between pb-2 border-b border-[#1b2640]">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
            Nhiệm vụ trích xuất từ cuộc họp
          </h3>
          <p className="text-xs text-slate-400 mt-1 pl-3.5">Chỉ hiển thị nhiệm vụ đã được lưu từ kết quả xử lý.</p>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-[#182642] text-xs font-semibold text-[#38bdf8] border border-[#233863] whitespace-nowrap shrink-0">
          {tasks.length} Tasks
        </span>
      </div>

      {loading && <p className="text-sm text-slate-400 text-center py-8">Đang tải nhiệm vụ…</p>}
      {!loading && error && <p role="alert" className="text-sm text-amber-200 text-center py-8">{error}</p>}
      {!loading && !error && tasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#263451] bg-[#0d1526] px-5 py-8 text-center">
          <p className="text-sm font-semibold text-slate-200">
            {llmStatus === 'NOT_PROCESSED' ? 'Chưa xử lý AI' : 'Chưa có nhiệm vụ được lưu'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Hệ thống không tự tạo nhiệm vụ, người phụ trách hoặc hạn chót khi chưa có kết quả được kiểm chứng.
          </p>
        </div>
      )}
      {!loading && !error && tasks.map((task, index) => (
        <article key={task.id || `${task.title}-${index}`} className="p-4 rounded-2xl bg-[#0d1526] border border-[#1b2742]">
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-[#16223b] text-slate-300 font-bold text-xs flex items-center justify-center border border-[#223359] shrink-0">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-slate-100">{task.title}</h4>
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="uppercase font-bold text-slate-500">Người phụ trách</dt>
                  <dd className="mt-1 text-slate-300">{task.assigneeName || 'Không nêu trong kết quả'}</dd>
                </div>
                <div>
                  <dt className="uppercase font-bold text-slate-500">Hạn chót</dt>
                  <dd className="mt-1 text-slate-300">{task.deadlineRaw || task.dueDate || 'Không nêu trong kết quả'}</dd>
                </div>
                <div>
                  <dt className="uppercase font-bold text-slate-500">Trạng thái</dt>
                  <dd className="mt-1 text-slate-300">{task.status || 'Chưa xác định'}</dd>
                </div>
              </dl>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
