import React, { useState } from 'react';

export default function MeetingTasksTab() {
  const [tasks, setTasks] = useState([
    {
      id: '1',
      content: 'Hoàn thiện dev environment và kiểm tra preliminary tests',
      time: '13:12',
      assigner: 'Alex Nguyen',
      assignee: 'Sarah Chen',
      deadline: '2026-10-05',
    },
    {
      id: '2',
      content: 'Đồng bộ với Infrastructure team về các API endpoint mới',
      time: '13:40',
      assigner: 'Alex Nguyen',
      assignee: 'Sarah Chen',
      deadline: '2026-10-02',
    },
    {
      id: '3',
      content: 'Cập nhật lại tài liệu kỹ thuật (documentation)',
      time: '14:05',
      assigner: 'Michael Scott',
      assignee: '', // Bị khuyết để user điền
      deadline: '', // Bị khuyết để user điền
    },
  ]);

  const handleUpdate = (id, field, value) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const memberOptions = [
    'Alex Nguyen',
    'Sarah Chen',
    'Michael Scott',
    'David Park',
    'Elena Rostova',
    'Rachel Green',
    'Jessica Taylor',
    'Kevin Lee',
    'Marcus Brody',
  ];

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex items-center justify-between pb-2 border-b border-[#1b2640]">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block"></span>
            Nhiệm vụ trích xuất từ cuộc họp (AI Task Extraction)
          </h3>
          <p className="text-xs text-slate-400 mt-1 pl-3.5">
            Các trường AI không phát hiện được sẽ để trống để bạn tự chọn hoặc chỉnh sửa.
          </p>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-[#182642] text-xs font-semibold text-[#38bdf8] border border-[#233863] whitespace-nowrap shrink-0">
          {tasks.length} Tasks
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {tasks.map((task, idx) => (
          <div
            key={task.id}
            className="p-4 rounded-2xl bg-[#0d1526] border border-[#1b2742] flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#16223b] text-slate-300 font-bold text-xs flex items-center justify-center border border-[#223359]">
                  {idx + 1}
                </span>
                <span className="font-mono text-xs text-[#38bdf8] px-1.5 py-0.5 rounded bg-[#0a1222] border border-[#1b2947]">
                  {task.time}
                </span>
              </div>
            </div>

            {/* Nội dung task */}
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                Nội dung công việc:
              </label>
              <input
                type="text"
                value={task.content}
                onChange={(e) => handleUpdate(task.id, 'content', e.target.value)}
                className="w-full bg-[#11192e] border border-[#213054] rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#38bdf8]"
              />
            </div>

            {/* Grid 3 cột: Người phân công (Dropdown), Người chịu trách nhiệm (Dropdown), Deadline */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Dropdown: Người phân công */}
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                  Người phân công
                </label>
                <div className="relative">
                  <select
                    value={task.assigner}
                    onChange={(e) => handleUpdate(task.id, 'assigner', e.target.value)}
                    className="w-full bg-[#11192e] border border-[#213054] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#38bdf8] appearance-none pr-8 cursor-pointer"
                  >
                    <option value="" className="bg-[#0e172a] text-slate-500">
                      -- Chọn người phân công --
                    </option>
                    {memberOptions.map((name) => (
                      <option key={name} value={name} className="bg-[#0e172a] text-slate-200">
                        {name}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Dropdown: Người chịu trách nhiệm */}
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                  Người chịu trách nhiệm
                </label>
                <div className="relative">
                  <select
                    value={task.assignee}
                    onChange={(e) => handleUpdate(task.id, 'assignee', e.target.value)}
                    className={`w-full bg-[#11192e] border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#38bdf8] appearance-none pr-8 cursor-pointer ${
                      task.assignee ? 'border-[#213054] text-slate-200' : 'border-amber-500/50 text-amber-300'
                    }`}
                  >
                    <option value="" className="bg-[#0e172a] text-amber-400/80">
                      -- Chưa gán (Bấm để chọn) --
                    </option>
                    {memberOptions.map((name) => (
                      <option key={name} value={name} className="bg-[#0e172a] text-slate-200">
                        {name}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Deadline */}
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                  Hạn chót (Deadline)
                </label>
                <input
                  type="date"
                  value={task.deadline}
                  onChange={(e) => handleUpdate(task.id, 'deadline', e.target.value)}
                  className="w-full bg-[#11192e] border border-[#213054] rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-[#38bdf8]"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
