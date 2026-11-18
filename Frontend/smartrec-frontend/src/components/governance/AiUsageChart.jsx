import React, { useMemo, useState } from 'react';
import ChartJsCanvas from './ChartJsCanvas';

function formatCompactTokens(value) {
  const num = Number(value) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

const DARK_TOOLTIP = {
  backgroundColor: '#090f1d',
  borderColor: '#263a66',
  borderWidth: 1,
  titleColor: '#f8fafc',
  bodyColor: '#cbd5e1',
  padding: 10,
  cornerRadius: 10,
};

export default function AiUsageChart({
  dailySeries = [],
  modelBreakdown = [],
  summary = {},
}) {
  const [resourceMode, setResourceMode] = useState('hardware'); // 'hardware' | 'tokens'

  const totalJobs = Math.max(1, summary.totalJobs || 0);
  const localJobs = summary.localJobs || 0;
  const cloudJobs = summary.cloudJobs || 0;
  const localPct = Math.round((localJobs / totalJobs) * 100);
  const cloudPct = 100 - localPct;

  const labels = useMemo(() => dailySeries.map((d) => d.label), [dailySeries]);

  // 1. Resource Trend Chart (Chart.js Line)
  const resourceChartData = useMemo(() => {
    if (resourceMode === 'tokens') {
      return {
        labels,
        datasets: [
          {
            label: 'Total Tokens',
            data: dailySeries.map((d) => d.totalTokens),
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.16)',
            fill: true,
            tension: 0.35,
            pointRadius: 3.5,
            pointHoverRadius: 5,
            yAxisID: 'y',
          },
          {
            label: 'Latency TB (s)',
            data: dailySeries.map((d) => d.avgLatency),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            fill: false,
            tension: 0.35,
            pointRadius: 3.5,
            pointHoverRadius: 5,
            yAxisID: 'y1',
          },
        ],
      };
    }

    return {
      labels,
      datasets: [
        {
          label: 'CPU (%)',
          data: dailySeries.map((d) => d.avgCpuUsage),
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.14)',
          fill: true,
          tension: 0.35,
          pointRadius: 3.5,
          pointHoverRadius: 5,
          yAxisID: 'y',
        },
        {
          label: 'VRAM (GB)',
          data: dailySeries.map((d) => d.avgVramGb),
          borderColor: '#a855f7',
          backgroundColor: 'rgba(168, 85, 247, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 3.5,
          pointHoverRadius: 5,
          yAxisID: 'y1',
        },
        {
          label: 'RAM (GB)',
          data: dailySeries.map((d) => d.avgRamGb),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          fill: false,
          tension: 0.35,
          pointRadius: 3.5,
          pointHoverRadius: 5,
          yAxisID: 'y1',
        },
      ],
    };
  }, [dailySeries, labels, resourceMode]);

  const resourceChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 12 },
        },
        tooltip: DARK_TOOLTIP,
      },
      scales: {
        x: {
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
          ticks: { color: '#94a3b8', font: { size: 10 } },
        },
        y: {
          position: 'left',
          beginAtZero: true,
          suggestedMax: resourceMode === 'hardware' ? 100 : undefined,
          grid: { color: 'rgba(148, 163, 184, 0.12)' },
          ticks: {
            color: '#38bdf8',
            font: { size: 10 },
            callback: (val) =>
              resourceMode === 'hardware' ? `${val}%` : formatCompactTokens(val),
          },
        },
        y1: {
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: {
            color: resourceMode === 'hardware' ? '#c084fc' : '#fbbf24',
            font: { size: 10 },
            callback: (val) => (resourceMode === 'hardware' ? `${val}G` : `${val}s`),
          },
        },
      },
    }),
    [resourceMode]
  );

  // 2. Cost Trend Chart ($0 Local vs Cloud Fallback)
  const costChartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: 'Chi phí Cloud Fallback ($)',
          data: dailySeries.map((d) => Number(d.estimatedCost || 0)),
          backgroundColor: dailySeries.map((d) =>
            d.estimatedCost > 0 ? 'rgba(245, 158, 11, 0.85)' : 'rgba(16, 185, 129, 0.65)'
          ),
          borderColor: dailySeries.map((d) =>
            d.estimatedCost > 0 ? '#fbbf24' : '#34d399'
          ),
          borderWidth: 1,
          borderRadius: 6,
          minBarLength: 6,
        },
      ],
    }),
    [dailySeries, labels]
  );

  const costChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 12 },
        },
        tooltip: {
          ...DARK_TOOLTIP,
          callbacks: {
            label: (ctx) => {
              const idx = ctx.dataIndex;
              const point = dailySeries[idx];
              const val = Number(ctx.parsed.y || 0);
              if (val === 0) {
                return ` $0.00 (100% Local Free · ${point?.localCount || 0} jobs)`;
              }
              return ` $${val.toFixed(5)} (${point?.fallbackCount || 0} fallback jobs)`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
          ticks: { color: '#94a3b8', font: { size: 10 } },
        },
        y: {
          beginAtZero: true,
          suggestedMax: 0.015,
          grid: { color: 'rgba(148, 163, 184, 0.12)' },
          ticks: {
            color: '#fbbf24',
            font: { size: 10 },
            callback: (val) => `$${Number(val).toFixed(3)}`,
          },
        },
      },
    }),
    [dailySeries]
  );

  // 3. Doughnut Runtime Chart ($0 Local vs Cloud Fallback)
  const runtimeDoughnutData = useMemo(
    () => ({
      labels: ['Local ($0.00)', 'Cloud Fallback ($)'],
      datasets: [
        {
          data: [localJobs, cloudJobs],
          backgroundColor: ['rgba(16, 185, 129, 0.85)', 'rgba(245, 158, 11, 0.85)'],
          borderColor: ['#0c1324', '#0c1324'],
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    }),
    [localJobs, cloudJobs]
  );

  const runtimeDoughnutOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 12, padding: 12 },
        },
        tooltip: DARK_TOOLTIP,
      },
    }),
    []
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Row 1: Resource Trend Chart (2/3) + Runtime Doughnut & Model Breakdown (1/3) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#18233c]">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
                Xu hướng Tiêu thụ Tài nguyên AI (Chart.js)
              </h3>
              <p className="text-xs text-slate-400 mt-1 pl-3.5">
                Theo dõi tải CPU (%), RAM (GB), VRAM (GB) và lưu lượng Tokens theo từng ngày.
              </p>
            </div>

            <div className="inline-flex rounded-lg bg-[#090f1d] border border-[#1d2b4a] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setResourceMode('hardware')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  resourceMode === 'hardware'
                    ? 'bg-[#2563eb] text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Tài nguyên (CPU/RAM/VRAM)
              </button>
              <button
                type="button"
                onClick={() => setResourceMode('tokens')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  resourceMode === 'tokens'
                    ? 'bg-[#2563eb] text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Tokens &amp; Latency
              </button>
            </div>
          </div>

          <div className="mt-4 h-64 w-full">
            {dailySeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Không có dữ liệu biểu đồ cho bộ lọc hiện tại.
              </div>
            ) : (
              <ChartJsCanvas
                type="line"
                data={resourceChartData}
                options={resourceChartOptions}
                ariaLabel="Đồ thị Chart.js xu hướng tiêu thụ tài nguyên AI"
              />
            )}
          </div>
        </div>

        {/* Right: Doughnut Local $0 vs Cloud Fallback + Model Breakdown */}
        <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg flex flex-col gap-4">
          <div className="pb-3 border-b border-[#18233c]">
            <h3 className="text-sm font-bold text-white">Phân bổ Local ($0) &amp; Cloud</h3>
            <p className="text-xs text-slate-400 mt-1">
              {localPct}% Local ($0.00) · {cloudPct}% Cloud Fallback
            </p>
          </div>

          <div className="h-44 w-full relative">
            <ChartJsCanvas
              type="doughnut"
              data={runtimeDoughnutData}
              options={runtimeDoughnutOptions}
              ariaLabel="Đồ thị Chart.js tỷ trọng Local $0 và Cloud Fallback"
            />
          </div>

          <div className="space-y-2.5 flex-1 overflow-y-auto pr-1">
            {modelBreakdown.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Chưa có dữ liệu model.</p>
            ) : (
              modelBreakdown.map((item) => {
                const tokenShare =
                  summary.totalTokens > 0
                    ? Math.round((item.totalTokens / summary.totalTokens) * 100)
                    : 0;
                return (
                  <div
                    key={item.modelName}
                    className="rounded-xl bg-[#090f1d] border border-[#162138] p-2.5 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-white truncate">
                        {item.modelName}
                      </span>
                      <span className="text-[11px] font-mono text-[#38bdf8] shrink-0">
                        {formatCompactTokens(item.totalTokens)} tok
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-[#152037] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          item.runtime === 'local' ? 'bg-emerald-400' : 'bg-amber-400'
                        }`}
                        style={{ width: `${Math.max(6, tokenShare)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>
                        {item.jobCount} jobs · TB {item.avgProcessingTime.toFixed(1)}s
                      </span>
                      <span
                        className={`font-mono ${
                          item.estimatedCost > 0 ? 'text-amber-300' : 'text-emerald-300'
                        }`}
                      >
                        {item.estimatedCost > 0
                          ? `$${item.estimatedCost.toFixed(4)}`
                          : '$0.00 (Local)'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Daily Cost Trend ($0 Local vs Cloud Fallback) */}
      <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#18233c]">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-4 bg-emerald-400 rounded-full inline-block" />
              Xu hướng Chi phí AI theo Ngày ($0 Local vs Cloud Fallback)
            </h3>
            <p className="text-xs text-slate-400 mt-1 pl-3.5">
              Cột xanh đánh dấu ngày vận hành 100% Local với chi phí <strong className="text-emerald-300">$0.00</strong>; cột vàng thể hiện chi phí Cloud Fallback.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 font-semibold font-mono">
              Chi phí Local: $0.00
            </span>
            <span className="px-2.5 py-1 rounded-full bg-sky-950/40 border border-[#38bdf8]/30 text-[#38bdf8] font-semibold font-mono">
              Tiết kiệm ước tính: ~${Number(summary.estimatedLocalSavingsUsd || 0).toFixed(4)}
            </span>
          </div>
        </div>

        <div className="mt-4 h-56 w-full">
          {dailySeries.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              Không có dữ liệu chi phí cho bộ lọc hiện tại.
            </div>
          ) : (
            <ChartJsCanvas
              type="bar"
              data={costChartData}
              options={costChartOptions}
              ariaLabel="Đồ thị Chart.js xu hướng chi phí AI theo ngày"
            />
          )}
        </div>
      </div>
    </div>
  );
}
