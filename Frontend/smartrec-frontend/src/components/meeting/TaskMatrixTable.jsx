import React, { useState } from 'react';
import mockSummaryData from '../../mocks/mock_summary.json';


function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map((p) => Number(p.trim()) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(timeStr) || 0;
}

export default function TaskMatrixTable({ onSeekSegment }) {
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
      onSeekSegment(parseTimeToSeconds(timeStr));
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 text-slate-300">
      {/* Header */}
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

      {/* Table Ma trận công việc */}
      <div className="w-full overflow-x-auto rounded-2xl border border-[#1b2742] bg-[#0d1526] shadow-xl">
        <table className="w-full min-w-[780px] text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#18233d] bg-[#090f1d] text-slate-400 font-semibold uppercase tracking-wider text-[11px] whitespace-nowrap">
              <th className="py-3.5 px-4 w-12 text-center">#</th>
              <th className="py-3.5 px-4 min-w-[280px]">Nhiệm vụ (Task)</th>
              <th className="py-3.5 px-3 w-28 text-center">Thời gian</th>
              <th className="py-3.5 px-4 w-44">Người thực hiện</th>
              <th className="py-3.5 px-4 w-36">Người giám sát</th>
              <th className="py-3.5 px-4 w-36">Hạn chót</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#152037]">
            {tasks.map((task) => (
              <tr key={task.task_index} className="hover:bg-[#121c33] transition">
                {/* STT */}
                <td className="py-3.5 px-4 text-center font-bold text-slate-400 whitespace-nowrap">
                  {task.task_index}
                </td>

                {/* Nội dung task */}
                <td className="py-3.5 px-4 text-slate-200 font-medium leading-relaxed">
                  {task.content}
                </td>

                {/* Timestamp + Nút tua video */}
                <td className="py-3.5 px-3 text-center whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSeek(task.timestamp)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap bg-[#101b30] hover:bg-[#1c3057] text-[#38bdf8] font-mono font-bold px-2.5 py-1 rounded border border-[#233a69] transition text-[11px]"
                    title="Nhấp để tua video đến mốc này"
                  >
                    ▶ {task.timestamp}
                  </button>
                </td>

                {/* Assignee (Dropdown chọn / sửa) */}
                <td className="py-3.5 px-4 whitespace-nowrap">
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

                {/* Responsible */}
                <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                  {task.responsible || <span className="text-slate-500 italic">Chưa xác định</span>}
                </td>

                {/* Deadline (Input Date) */}
                <td className="py-3.5 px-4 whitespace-nowrap">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

