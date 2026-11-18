import React, { useState } from 'react';
import { CLEANUP_TASK_TYPES, formatBytes } from '../../services/storageAdminService';

export default function StorageCleanupPanel({
  overview,
  runningTask,
  lastCleanupResult,
  onRunCleanup,
}) {
  const [confirmTask, setConfirmTask] = useState(null);

  const data = overview || {};
  const tasks = [
    {
      taskType: CLEANUP_TASK_TYPES.EXPIRED_TRASH,
      title: 'Trash quá hạn (Retention)',
      description: 'Xóa vĩnh viễn file TRASHED đã qua thời hạn purge_at khỏi MinIO & DB.',
      count: Number(data.expiredTrashCount || 0),
      bytes: Number(data.expiredTrashBytes || 0),
      badgeColor: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
    },
    {
      taskType: CLEANUP_TASK_TYPES.STALE_PENDING_UPLOADS,
      title: 'Pending Upload quá hạn',
      description: 'Dọn presigned upload chưa hoàn tất đã hết hạn và xóa file tạm trên MinIO.',
      count: Number(data.stalePendingUploadsCount || 0),
      bytes: Number(data.stalePendingUploadBytes || 0),
      badgeColor: 'text-sky-300 bg-sky-500/15 border-sky-500/30',
    },
    {
      taskType: CLEANUP_TASK_TYPES.CANCELLED_CHUNK_SESSIONS,
      title: 'Upload Session đã hủy',
      description: 'Xóa chunk/staged objects và trạng thái Redis/DB của các session CANCELLED.',
      count: Number(data.cancelledUploadSessionsCount || 0),
      bytes: null,
      badgeColor: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/30',
    },
    {
      taskType: CLEANUP_TASK_TYPES.ORPHAN_MINIO_OBJECTS,
      title: 'Orphan Objects trên MinIO',
      description: 'Xóa object trôi nổi trên bucket không còn liên kết trong PostgreSQL.',
      count: Number(data.orphanObjectCount || 0),
      bytes: Number(data.orphanTotalSizeBytes || 0),
      badgeColor: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
    },
  ];

  const totalPendingGarbage = tasks.reduce((sum, item) => sum + item.count, 0);

  const handleTrigger = async (taskType) => {
    setConfirmTask(null);
    await onRunCleanup(taskType);
  };

  return (
    <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 flex flex-col gap-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Storage Cleanup Engine</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Kích hoạt dọn dẹp rác lưu trữ an toàn — không chạm tới file <code className="text-[#38bdf8]">UPLOADED</code> đang hoạt động.
          </p>
        </div>

        <button
          type="button"
          disabled={Boolean(runningTask) || totalPendingGarbage === 0}
          onClick={() => setConfirmTask({ taskType: CLEANUP_TASK_TYPES.ALL_SAFE, label: 'toàn bộ 4 tác vụ dọn dẹp an toàn' })}
          className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-45 disabled:cursor-not-allowed text-white transition shadow-sm self-start md:self-auto"
        >
          {runningTask === CLEANUP_TASK_TYPES.ALL_SAFE
            ? 'Đang chạy dọn dẹp...'
            : `Chạy tất cả dọn dẹp an toàn (${totalPendingGarbage})`}
        </button>
      </div>

      {confirmTask && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <span className="text-amber-200">
            Xác nhận chạy <strong>{confirmTask.label}</strong>? Các object rác đã chọn sẽ bị xóa khỏi MinIO/DB.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmTask(null)}
              className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:text-white"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => handleTrigger(confirmTask.taskType)}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold"
            >
              Xác nhận chạy
            </button>
          </div>
        </div>
      )}

      {lastCleanupResult && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-2.5 text-xs flex flex-col gap-1 ${
            lastCleanupResult.failedCount > 0
              ? 'border-amber-500/40 bg-amber-950/25 text-amber-200'
              : 'border-emerald-500/40 bg-emerald-950/25 text-emerald-200'
          }`}
        >
          <div className="font-semibold">{lastCleanupResult.message}</div>
          <div className="text-[11px] opacity-85">
            Đã xử lý: {lastCleanupResult.processedCount} · Thành công: {lastCleanupResult.deletedCount} · Thất bại:{' '}
            {lastCleanupResult.failedCount} · Giải phóng: {formatBytes(lastCleanupResult.freedBytes)}
          </div>
          {Array.isArray(lastCleanupResult.errors) && lastCleanupResult.errors.length > 0 && (
            <ul className="list-disc list-inside text-[11px] text-rose-300 mt-1">
              {lastCleanupResult.errors.slice(0, 3).map((err, index) => (
                <li key={index}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {tasks.map((task) => {
          const isBusy = runningTask === task.taskType;
          return (
            <div
              key={task.taskType}
              className="rounded-xl border border-[#1b2742] bg-[#090f1d] p-4 flex flex-col justify-between gap-3"
            >
              <div className="flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-semibold text-white">{task.title}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${task.badgeColor}`}>
                    {task.count}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">{task.description}</p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#141e35]">
                <span className="text-[11px] text-slate-400">
                  {task.bytes === null ? 'Chunks / Redis' : `Ước tính: ${formatBytes(task.bytes)}`}
                </span>
                <button
                  type="button"
                  disabled={Boolean(runningTask) || task.count === 0}
                  onClick={() => setConfirmTask({ taskType: task.taskType, label: task.title })}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#13203d] hover:bg-[#1e325c] text-[#38bdf8] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {isBusy ? 'Đang dọn...' : 'Dọn ngay'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

