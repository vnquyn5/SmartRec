import React, { useMemo, useState } from 'react';
import ChartJsCanvas from '../governance/ChartJsCanvas';
import { formatBytes } from '../../services/storageAdminService';

const STATUS_COLORS = {
  UPLOADED: '#18c99a',
  TRASHED: '#f59e0b',
  UPLOADING: '#38bdf8',
  INTEGRITY_FAILED: '#fb7185',
};

const MIME_COLORS = {
  Audio: '#38bdf8',
  Video: '#2563eb',
  Other: '#94a3b8',
};

export default function StorageChartsPanel({ overview }) {
  const [breakdownMode, setBreakdownMode] = useState('status');

  const doughnutData = useMemo(() => {
    if (!overview) return { labels: [], datasets: [] };
    if (breakdownMode === 'mime') {
      const rows = overview.mimeBreakdown || [];
      return {
        labels: rows.map((r) => `${r.category} (${r.count})`),
        datasets: [
          {
            data: rows.map((r) => Math.max(0, Number(r.sizeBytes || 0))),
            backgroundColor: rows.map((r) => MIME_COLORS[r.category] || '#64748b'),
            borderColor: '#0c1324',
            borderWidth: 2,
          },
        ],
      };
    }

    const rows = overview.statusBreakdown || [];
    return {
      labels: rows.map((r) => `${r.status} (${r.count})`),
      datasets: [
        {
          data: rows.map((r) => Math.max(0, Number(r.sizeBytes || 0))),
          backgroundColor: rows.map((r) => STATUS_COLORS[r.status] || '#64748b'),
          borderColor: '#0c1324',
          borderWidth: 2,
        },
      ],
    };
  }, [overview, breakdownMode]);

  const doughnutOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#cbd5e1',
            font: { size: 11 },
            padding: 14,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatBytes(ctx.parsed)}`,
          },
        },
      },
    }),
    []
  );

  const trendData = useMemo(() => {
    const trend = overview?.recentDailyTrend || [];
    return {
      labels: trend.map((d) => d.date.slice(5)),
      datasets: [
        {
          label: 'Dung lượng upload (MB)',
          data: trend.map((d) => Number(((d.sizeBytes || 0) / (1024 * 1024)).toFixed(2))),
          backgroundColor: 'rgba(56, 189, 248, 0.72)',
          borderColor: '#38bdf8',
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [overview]);

  const trendOptions = useMemo(() => {
    const trend = overview?.recentDailyTrend || [];
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => {
              const item = trend[ctx.dataIndex];
              return item ? `Số file: ${item.fileCount} (${formatBytes(item.sizeBytes)})` : '';
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
          ticks: { color: '#94a3b8', font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(148, 163, 184, 0.1)' },
          ticks: {
            color: '#94a3b8',
            font: { size: 11 },
            callback: (val) => `${val} MB`,
          },
        },
      },
    };
  }, [overview]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className="lg:col-span-5 rounded-2xl border border-[#1b2640] bg-[#0c1324] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Phân bổ dung lượng lưu trữ</h2>
            <p className="text-[11px] text-slate-400">
              Tỷ trọng byte theo trạng thái hoặc định dạng file
            </p>
          </div>
          <div className="inline-flex rounded-lg bg-[#090f1d] border border-[#1b2742] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setBreakdownMode('status')}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                breakdownMode === 'status'
                  ? 'bg-[#2563eb] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Trạng thái
            </button>
            <button
              type="button"
              onClick={() => setBreakdownMode('mime')}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                breakdownMode === 'mime'
                  ? 'bg-[#2563eb] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Định dạng
            </button>
          </div>
        </div>
        <div className="h-60">
          <ChartJsCanvas
            type="doughnut"
            data={doughnutData}
            options={doughnutOptions}
            ariaLabel="Biểu đồ phân bổ dung lượng SmartRec Storage"
          />
        </div>
      </div>

      <div className="lg:col-span-7 rounded-2xl border border-[#1b2640] bg-[#0c1324] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Xu hướng dung lượng Upload (14 ngày)</h2>
            <p className="text-[11px] text-slate-400">
              Tổng dung lượng (MB) và số file phát sinh theo ngày UTC
            </p>
          </div>
          <span className="text-[11px] text-slate-400 bg-[#090f1d] border border-[#1b2640] px-2.5 py-1 rounded-full">
            Sessions active: {overview?.activeUploadSessionsCount ?? 0}
          </span>
        </div>
        <div className="h-60">
          <ChartJsCanvas
            type="bar"
            data={trendData}
            options={trendOptions}
            ariaLabel="Biểu đồ xu hướng upload 14 ngày"
          />
        </div>
      </div>
    </div>
  );
}

