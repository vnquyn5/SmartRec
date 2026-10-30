import React, { useEffect, useState } from 'react';

export default function MeetingTasksTab({ tasks: sourceTasks = [], onSeek }) {
  const [tasks, setTasks] = useState([]);
  useEffect(() => setTasks(sourceTasks.map((task, index) => ({ ...task, id: `${index}-${task.sourceStartTimeMs}` }))), [sourceTasks]);
  const update = (id, field, value) => setTasks((current) => current.map((task) => task.id === id ? { ...task, [field]: value } : task));
  const formatTime = (ms) => {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
      .map((part) => String(part).padStart(2, '0')).join(':');
  };

  return (
    <div className="w-full flex flex-col gap-4 text-slate-200">
      <div className="pb-3 border-b border-[#1b2640]">
        <h3 className="text-sm font-bold text-white">Nhiệm vụ từ cuộc họp</h3>
        <p className="mt-1 text-xs text-slate-400">Assignee và hạn chót không có bằng chứng trong transcript sẽ để trống.</p>
      </div>
      {!tasks.length ? <p className="text-sm text-slate-400">Chưa trích xuất được nhiệm vụ.</p> : tasks.map((task) => (
        <article key={task.id} className="rounded-xl border border-[#1b2742] bg-[#0d1526] p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <textarea aria-label="Task description" className="min-w-0 flex-1 resize-y rounded-lg border border-[#213054] bg-[#090f1d] p-2 text-sm" rows={2}
              value={task.description || ''} onChange={(event) => update(task.id, 'description', event.target.value)} />
            <button type="button" className="text-xs text-sky-300 hover:text-white" onClick={() => onSeek?.((Number(task.sourceStartTimeMs) || 0) / 1000)}>
              {formatTime(task.sourceStartTimeMs)}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">Assignee<input className="mt-1 w-full rounded-lg border border-[#213054] bg-[#090f1d] px-3 py-2 text-sm text-slate-200" value={task.assignee || ''} onChange={(event) => update(task.id, 'assignee', event.target.value)} /></label>
            <label className="text-xs text-slate-400">Deadline<input className="mt-1 w-full rounded-lg border border-[#213054] bg-[#090f1d] px-3 py-2 text-sm text-slate-200" value={task.deadline || ''} onChange={(event) => update(task.id, 'deadline', event.target.value)} /></label>
          </div>
          <p className="text-[11px] text-slate-500">{task.speakerLabel || 'Speaker chưa xác định'} · {task.confidence || 'verify'}</p>
        </article>
      ))}
    </div>
  );
}
