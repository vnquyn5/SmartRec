import React from 'react';
import { formatBytes } from '../../services/storageAdminService';

export default function StorageOverviewCards({ overview, loading }) {
  if (loading && !overview) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((idx) => (
          <div
            key={idx}
            className="h-32 rounded-2xl border border-[#1b2640] bg-[#0c1324] animate-pulse"
          />
        ))}
      </div>
    );
  }

  const data = overview || {};
  const totalBytes = Number(data.totalSizeBytes || 0);
  const uploadedShare =
    totalBytes > 0 ? Math.round((Number(data.uploadedSizeBytes || 0) / totalBytes) * 100) : 0;
  const trashedShare =
    totalBytes > 0 ? Math.round((Number(data.trashedSizeBytes || 0) / totalBytes) * 100) : 0;

  const reclaimableBytes =
    Number(data.expiredTrashBytes || 0) +
    Number(data.stalePendingUploadBytes || 0) +
    Number(data.orphanTotalSizeBytes || 0);
  const reclaimableCount =
    Number(data.expiredTrashCount || 0) +
    Number(data.stalePendingUploadsCount || 0) +
    Number(data.cancelledUploadSessionsCount || 0) +
    Number(data.orphanObjectCount || 0);

  const cards = [
    {
      label: 'Tổng dung lượng Media (DB)',
      value: formatBytes(data.totalSizeBytes),
      sub: `${data.totalFiles ?? 0} file · MinIO Bucket: ${formatBytes(data.minioTotalSizeBytes)} (${data.minioObjectCount ?? 0} objects)`,
      accent: 'text-[#38bdf8]',
      border: 'border-[#1b2b4b]',
    },
    {
      label: 'File hoạt động (UPLOADED)',
      value: formatBytes(data.uploadedSizeBytes),
      sub: `${data.uploadedFiles ?? 0} file (${uploadedShare}% tổng DB) · Đang upload: ${data.uploadingFiles ?? 0}`,
      accent: 'text-[#18c99a]',
      border: 'border-[#153a38]',
    },
    {
      label: 'Thùng rác & Lỗi toàn vẹn',
      value: formatBytes(data.trashedSizeBytes),
      sub: `${data.trashedFiles ?? 0} trong Trash (${trashedShare}%) · Hết hạn purge: ${data.expiredTrashCount ?? 0} · Lỗi: ${data.integrityFailedFiles ?? 0}`,
      accent: 'text-[#f59e0b]',
      border: 'border-[#3d2e14]',
    },
    {
      label: 'Có thể thu hồi (Reclaimable)',
      value: formatBytes(reclaimableBytes),
      sub: `${reclaimableCount} mục rác (${data.orphanObjectCount ?? 0} orphan MinIO · ${data.stalePendingUploadsCount ?? 0} pending quá hạn)`,
      accent: reclaimableCount > 0 ? 'text-rose-400' : 'text-slate-300',
      border: reclaimableCount > 0 ? 'border-rose-500/35' : 'border-[#1b2640]',
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {data.minioWarning && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200 flex items-center justify-between gap-3"
        >
          <span>
            <strong className="font-semibold">Cảnh báo MinIO:</strong> {data.minioWarning} — Đang hiển thị số liệu từ PostgreSQL.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`rounded-2xl border ${card.border} bg-[#0c1324] p-4 flex flex-col justify-between gap-2 shadow-sm`}
          >
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
              {card.label}
            </span>
            <div className={`text-2xl font-bold tracking-tight ${card.accent}`}>
              {card.value}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">{card.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

