import React, { useState } from 'react';
import mockSummaryData from '../../mocks/mock_summary.json';
import { timeToSeconds } from '../../utils/timeFormat';

const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];

const PRIORITY_STYLES = {
  High: 'border-rose-500/50 bg-rose-950/40 text-rose-300',
  Medium: 'border-amber-500/50 bg-amber-950/40 text-amber-300',
  Low: 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300',
};

export default function TaskMatrixTable({ onSeekSegment, onInspectEvidence }) {
  const initialTasks = mockSummaryData?.task || [];
  const [tasks, setTasks] = useState(initialTasks);

  const memberOptions = [
    'dev_team',
    'Alex Nguyen',
    'Sarah Lee',
    'Michael Scott',
    'David Park',
    'Jessica Taylor'
  ];

  const handleUpdate = (taskIndex, field, value) => {
    setTasks((prev) =>
      prev.map((t) => (t.task_index === taskIndex ? { ...t, [field]: value } : t))
    );
  };

  const handleSeek = (timeStr) => {
    if (typeof onSeekSegment === 'function' && timeStr) {
      onSeekSegment(timeToSeconds(timeStr));
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 text-slate-300">
      <div className="flex items-center justify-between pb-2 border-b border-[#1b2640]">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block"></span>
            Ma trận Công việc & Hành động (Task Matrix Table)
          </h3>
          <p className="text-xs text-slate-400 mt-1 pl-3.5">
            Bảng theo dõi Action Items trích xuất từ cuộc họp · Hỗ trợ bổ sung Assignee và Deadline trực tiếp
          </p>
        </div>
      </div>

      <div className="w-full overflow-x-auto rounded-2xl border border-[#1b2742] bg-[#0d1526] shadow-xl">
        <table className="w-full min-w-[840px] text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#18233d] bg-[#090f1d] text-slate-400 font-semibold uppercase tracking-wider text-[11px] whitespace-nowrap">
              <th className="py-3.5 px-3 w-12 text-center">#</th>
              <th className="py-3.5 px-4 min-w-[280px]">Nhiệm vụ (Task)</th>
              <th className="py-3.5 px-3 w-28 text-center">Thời gian</th>
              <th className="py-3.5 px-4 w-44">Người thực hiện</th>
              <th className="py-3.5 px-4 w-36">Người giám sát</th>
              <th className="py-3.5 px-4 w-36">Hạn chót</th>
              <th className="py-3.5 px-4 w-32 text-center">Độ ưu tiên</th>
              <th className="py-3.5 px-3 w-32 text-center">Minh chứng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#152037]">
            {tasks.map((task) => (
              <tr 
                key={task.task_index} 
                className="hover:bg-[#121c33] transition cursor-pointer"
                onClick={() => handleSeek(task.timestamp)}
              >
                <td className="py-3.5 px-3 text-center font-bold text-slate-400 whitespace-nowrap">
                  {task.task_index}
                </td>

                <td 
                  className="py-3.5 px-4 text-slate-200 font-medium leading-relaxed hover:text-[#38bdf8] transition-colors"
                  title="Nhấp để phát đoạn thảo luận nhiệm vụ này"
                >
                  {task.content}
                </td>

                <td className="py-3.5 px-3 text-center whitespace-nowrap">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSeek(task.timestamp);
                    }}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap bg-[#101b30] hover:bg-[#1c3057] text-[#38bdf8] font-mono font-bold px-2.5 py-1 rounded border border-[#233a69] transition text-[11px]"
                    title="Nhấp để tua video đến mốc này"
                  >
                    ▶ {task.timestamp}
                  </button>
                </td>

                <td className="py-3.5 px-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={task.assignee || ''}
                    onChange={(e) => handleUpdate(task.task_index, 'assignee', e.target.value)}
                    className={`w-full rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-[#38bdf8] cursor-pointer transition [color-scheme:dark] ${
                      task.assignee
                        ? 'border border-[#1f3054] bg-[#0a1122] text-slate-200'
                        : 'border border-amber-500/60 bg-amber-950/40 text-amber-300 font-medium'
                    }`}
                  >
                    <option value="" className="bg-[#0b1325] text-amber-400 font-semibold">
                      -- Chưa gán --
                    </option>
                    {memberOptions.map((m) => (
                      <option key={m} value={m} className="bg-[#0b1325] text-slate-200 font-normal">
                        {m}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                  {task.responsible || <span className="text-slate-500 italic">Chưa xác định</span>}
                </td>

                <td className="py-3.5 px-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="date"
                    value={task.deadline || ''}
                    onChange={(e) => handleUpdate(task.task_index, 'deadline', e.target.value)}
                    className={`w-full rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#38bdf8] transition [color-scheme:dark] cursor-pointer ${
                      task.deadline
                        ? 'border border-[#1f3054] bg-[#0a1122] text-slate-200'
                        : 'border border-amber-500/60 bg-amber-950/40 text-amber-300 font-medium'
                    }`}
                  />
                </td>

                <td className="py-3.5 px-4 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={task.priority || 'Medium'}
                    onChange={(e) => handleUpdate(task.task_index, 'priority', e.target.value)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-none cursor-pointer border transition [color-scheme:dark] ${
                      PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.Medium
                    }`}
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p} className="bg-[#0b1325] text-slate-200 font-medium">
                        {p}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="py-3.5 px-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onInspectEvidence?.(task)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 text-[11px] font-semibold transition cursor-pointer shadow-sm active:scale-95"
                    title="Xem minh chứng câu thoại gốc trích xuất ra nhiệm vụ này"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
                    </svg>
                    <span>Minh chứng</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
