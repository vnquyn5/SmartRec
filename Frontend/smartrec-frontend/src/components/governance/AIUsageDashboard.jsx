import React, { useEffect, useState } from 'react';
import AiUsageChart from './AiUsageChart';

const RANGE_OPTIONS = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: 'all', label: 'Tất cả' },
];

const PAGE_SIZE = 6;

function formatDateTime(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function UsageLogDetailModal({ log, onClose }) {
  useEffect(() => {
    if (!log) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [log, onClose]);

  if (!log) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="usage-detail-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] bg-[#0c101d] border border-[#1e2742] rounded-2xl shadow-2xl p-6 text-xs text-slate-300"
      >
        <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-[#18233c]">
          <div>
            <h3 id="usage-detail-modal-title" className="text-base font-bold text-white">
              Chi tiết Telemetry Job AI
            </h3>
            <p className="font-mono text-[11px] text-[#38bdf8] mt-1">{log.jobId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng chi tiết"
            className="w-7 h-7 rounded-full bg-[#182035] hover:bg-[#222d4a] text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-[#11182c] border border-[#1b2742] p-3 col-span-2">
            <div className="text-slate-400 text-[11px]">Cuộc họp</div>
            <div className="text-white font-semibold mt-0.5">{log.meetingTitle || '—'}</div>
          </div>

          <div className="rounded-xl bg-[#11182c] border border-[#1b2742] p-3">
            <div className="text-slate-400 text-[11px]">Model & Version</div>
            <div className="font-mono text-white font-semibold mt-0.5">
              {log.modelName} <span className="text-slate-400">v{log.modelVersion}</span>
            </div>
          </div>

          <div className="rounded-xl bg-[#11182c] border border-[#1b2742] p-3">
            <div className="text-slate-400 text-[11px]">Runtime / Fallback</div>
            <div className="mt-0.5 font-semibold text-white">
              {log.runtime === 'local' ? 'Local' : 'External API'}{' '}
              {log.fallbackUsed && (
                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-500/40">
                  Fallback Used
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-[#11182c] border border-[#1b2742] p-3">
            <div className="text-slate-400 text-[11px]">Tokens (Input / Output)</div>
            <div className="font-mono text-white font-semibold mt-0.5">
              {(log.totalTokens || 0).toLocaleString()}{' '}
              <span className="text-slate-400 font-normal">
                ({(log.inputTokens || 0).toLocaleString()} / {(log.outputTokens || 0).toLocaleString()})
              </span>
            </div>
          </div>

          <div className="rounded-xl bg-[#11182c] border border-[#1b2742] p-3">
            <div className="text-slate-400 text-[11px]">Chi phí ước tính</div>
            <div className="font-mono text-amber-300 font-bold mt-0.5">
              ${Number(log.estimatedCost || 0).toFixed(5)}
            </div>
          </div>

          <div className="rounded-xl bg-[#11182c] border border-[#1b2742] p-3">
            <div className="text-slate-400 text-[11px]">Thời gian xử lý</div>
            <div className="font-mono text-white font-semibold mt-0.5">
              {Number(log.processingTime || 0).toFixed(2)}s
            </div>
          </div>

          <div className="rounded-xl bg-[#11182c] border border-[#1b2742] p-3">
            <div className="text-slate-400 text-[11px]">CPU / RAM / VRAM</div>
            <div className="font-mono text-white font-semibold mt-0.5">
              {log.cpuUsage != null ? `${log.cpuUsage}%` : '—'} ·{' '}
              {log.ramUsage != null ? `${Math.round(log.ramUsage)}MB` : '—'} ·{' '}
              {log.vramUsage != null ? `${Math.round(log.vramUsage)}MB` : 'N/A'}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-[#18223d] hover:bg-[#223057] text-white font-semibold transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AIUsageDashboard({
  usageData,
  policy,
  filters,
  loading = false,
  onFiltersChange,
}) {
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState(null);

  const summary = usageData?.summary || {};
  const logs = usageData?.logs || [];
  const availableModels = usageData?.availableModels || [];

  useEffect(() => {
    setPage(1);
  }, [filters]);

  const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedLogs = logs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const budgetUsd = Number(policy?.monthlyBudgetUsd) || 50;
  const budgetPct = Math.min(100, Math.round(((summary.totalCost || 0) / budgetUsd) * 100));
  const isNearBudget = budgetPct >= (Number(policy?.alertThresholdPct) || 80);

  const tokenQuota = Number(policy?.monthlyTokenQuota) || 2000000;
  const tokenPct = Math.min(100, Math.round(((summary.totalTokens || 0) / tokenQuota) * 100));

  const updateFilter = (patch) => {
    onFiltersChange?.({ ...filters, ...patch });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Filter Toolbar */}
      <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-4 flex flex-wrap items-center gap-3 text-xs">
        <div className="inline-flex rounded-xl bg-[#090f1d] border border-[#1d2b4a] p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateFilter({ range: opt.value })}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filters.range === opt.value
                  ? 'bg-[#2563eb] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <select
          value={filters.modelName}
          onChange={(e) => updateFilter({ modelName: e.target.value })}
          aria-label="Lọc theo Model AI"
          className="h-9 px-3 rounded-xl bg-[#090f1d] border border-[#223254] text-slate-200 focus:outline-none focus:border-[#38bdf8] [color-scheme:dark]"
        >
          <option value="ALL" className="bg-[#0b1325]">Tất cả Model</option>
          {availableModels.map((m) => (
            <option key={m} value={m} className="bg-[#0b1325]">
              {m}
            </option>
          ))}
        </select>

        <select
          value={filters.runtime}
          onChange={(e) => updateFilter({ runtime: e.target.value })}
          aria-label="Lọc theo Runtime"
          className="h-9 px-3 rounded-xl bg-[#090f1d] border border-[#223254] text-slate-200 focus:outline-none focus:border-[#38bdf8] [color-scheme:dark]"
        >
          <option value="ALL" className="bg-[#0b1325]">Tất cả Runtime</option>
          <option value="local" className="bg-[#0b1325]">Local</option>
          <option value="external_api" className="bg-[#0b1325]">External API</option>
        </select>

        <label className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-[#090f1d] border border-[#223254] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={Boolean(filters.fallbackOnly)}
            onChange={(e) => updateFilter({ fallbackOnly: e.target.checked })}
            className="w-3.5 h-3.5 rounded border-[#2c3c62] bg-[#0c1426] text-amber-400 focus:ring-0"
          />
          <span className="text-slate-300 font-medium">Chỉ xem Fallback</span>
        </label>

        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={filters.search || ''}
            onChange={(e) => updateFilter({ search: e.target.value })}
            placeholder="Tìm Job ID, tên cuộc họp, model..."
            className="w-full h-9 pl-3 pr-8 rounded-xl bg-[#090f1d] border border-[#223254] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#38bdf8]"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => updateFilter({ search: '' })}
              aria-label="Xóa tìm kiếm"
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {/* KPI 1: Total Tokens */}
        <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-4 shadow-md">
          <div className="text-[11px] font-medium text-slate-400">Tổng Tokens Tiêu thụ</div>
          <div className="text-xl font-bold font-mono text-white mt-1.5">
            {loading ? '...' : (summary.totalTokens || 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            In: {(summary.inputTokens || 0).toLocaleString()} · Out:{' '}
            {(summary.outputTokens || 0).toLocaleString()}
          </div>
          <div className="mt-2.5 w-full h-1.5 rounded-full bg-[#152037] overflow-hidden">
            <div className="h-full bg-[#38bdf8]" style={{ width: `${Math.max(2, tokenPct)}%` }} />
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            {tokenPct}% / {tokenQuota.toLocaleString()} quota tháng
          </div>
        </div>

        {/* KPI 2: Estimated Cost ($0 Local highlight) */}
        <div
          className={`rounded-2xl border p-4 shadow-md ${
            isNearBudget
              ? 'border-amber-500/50 bg-amber-950/15'
              : (summary.totalCost || 0) === 0
              ? 'border-emerald-500/40 bg-emerald-950/10'
              : 'border-[#1b2640] bg-[#0c1324]'
          }`}
        >
          <div className="text-[11px] font-medium text-slate-400">Chi phí Ước tính</div>
          <div
            className={`text-xl font-bold font-mono mt-1.5 ${
              (summary.totalCost || 0) === 0 ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {loading
              ? '...'
              : (summary.totalCost || 0) === 0
              ? '$0.00 (Local)'
              : `$${Number(summary.totalCost || 0).toFixed(4)}`}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Ngân sách: ${budgetUsd}/tháng · Tiết kiệm ~${Number(summary.estimatedLocalSavingsUsd || 0).toFixed(4)}
          </div>
          <div className="mt-2.5 w-full h-1.5 rounded-full bg-[#152037] overflow-hidden">
            <div
              className={`h-full ${
                isNearBudget
                  ? 'bg-rose-400'
                  : (summary.totalCost || 0) === 0
                  ? 'bg-emerald-400'
                  : 'bg-amber-400'
              }`}
              style={{ width: `${Math.max(2, budgetPct)}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Đã dùng {budgetPct}% ngân sách
          </div>
        </div>

        {/* KPI 3: Fallback Rate */}
        <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-4 shadow-md">
          <div className="text-[11px] font-medium text-slate-400">Tỷ lệ Cloud Fallback</div>
          <div className="text-xl font-bold font-mono text-[#38bdf8] mt-1.5">
            {loading ? '...' : `${Number(summary.fallbackRate || 0).toFixed(1)}%`}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {summary.fallbackCount || 0} / {summary.totalJobs || 0} jobs dùng fallback
          </div>
          <div className="text-[10px] text-emerald-400 mt-3">
            {summary.localJobs || 0} jobs chạy nội bộ hoàn toàn
          </div>
        </div>

        {/* KPI 4: Avg Latency & Hardware */}
        <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-4 shadow-md">
          <div className="text-[11px] font-medium text-slate-400">Hiệu năng & Tài nguyên TB</div>
          <div className="text-xl font-bold font-mono text-white mt-1.5">
            {loading ? '...' : `${Number(summary.avgProcessingTime || 0).toFixed(2)}s`}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            CPU: {Number(summary.avgCpuUsage || 0).toFixed(1)}% · RAM:{' '}
            {Math.round(summary.avgRamUsage || 0)}MB
          </div>
          <div className="text-[10px] text-sky-400 mt-3">
            VRAM TB: {summary.avgVramUsage > 0 ? `${(summary.avgVramUsage / 1024).toFixed(2)} GB` : 'CPU Only'}
          </div>
        </div>

        {/* KPI 5: Job Reliability */}
        <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-4 shadow-md">
          <div className="text-[11px] font-medium text-slate-400">Độ ổn định Job AI</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-1.5">
            {loading ? '...' : `${Number(summary.successRate || 0).toFixed(1)}%`}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {summary.successJobs || 0} thành công · {summary.failedJobs || 0} lỗi
          </div>
          <div className="text-[10px] text-slate-500 mt-3">
            Tổng {summary.totalJobs || 0} lượt thực thi model
          </div>
        </div>
      </div>

      {/* Charts */}
      <AiUsageChart
        dailySeries={usageData?.dailySeries || []}
        modelBreakdown={usageData?.modelBreakdown || []}
        summary={summary}
      />

      {/* Usage Telemetry Log Table */}
      <div className="rounded-2xl border border-[#1b2640] bg-[#090f1d] shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#18233c] flex flex-wrap items-center justify-between gap-2 bg-[#0b1222]">
          <div>
            <h3 className="text-sm font-bold text-white">
              Nhật ký AI Usage (<code className="text-[#38bdf8]">ai_usage</code>)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Nhấp vào một dòng để xem chi tiết tài nguyên CPU, RAM, VRAM và Token của Job.
            </p>
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#13223d] text-[#38bdf8] border border-[#233866]">
            {logs.length} bản ghi
          </span>
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[960px] text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#18233d] bg-[#080e1c] text-slate-400 font-semibold uppercase tracking-wider text-[11px] whitespace-nowrap">
                <th className="py-3.5 px-4">Thời gian</th>
                <th className="py-3.5 px-4">Cuộc họp / Job ID</th>
                <th className="py-3.5 px-3">Model</th>
                <th className="py-3.5 px-3">Runtime</th>
                <th className="py-3.5 px-3 text-right">Tokens</th>
                <th className="py-3.5 px-3 text-right">Latency</th>
                <th className="py-3.5 px-3 text-right">CPU / VRAM</th>
                <th className="py-3.5 px-3 text-right">Chi phí</th>
                <th className="py-3.5 px-4 text-center">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#152037]">
              {pagedLogs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400">
                    Không tìm thấy nhật ký AI Usage phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                pagedLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    data-testid="ai-usage-log-row"
                    className="hover:bg-[#101a32] cursor-pointer transition"
                  >
                    <td className="py-3.5 px-4 font-mono text-slate-300 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white line-clamp-1">
                        {log.meetingTitle || 'Untitled Meeting'}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">{log.jobId}</div>
                    </td>

                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <div className="font-mono font-semibold text-slate-200">{log.modelName}</div>
                      <div className="text-[10px] text-slate-400">
                        {log.stage} · v{log.modelVersion}
                      </div>
                    </td>

                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold ${
                          log.fallbackUsed
                            ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                            : log.runtime === 'local'
                            ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-300'
                            : 'border-sky-500/30 bg-sky-950/30 text-sky-300'
                        }`}
                      >
                        {log.fallbackUsed
                          ? 'Fallback Cloud'
                          : log.runtime === 'local'
                          ? 'Local'
                          : 'Cloud API'}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono text-white whitespace-nowrap">
                      {(log.totalTokens || 0).toLocaleString()}
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                      {Number(log.processingTime || 0).toFixed(2)}s
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                      {log.cpuUsage != null ? `${log.cpuUsage}%` : '—'} /{' '}
                      {log.vramUsage != null ? `${(log.vramUsage / 1024).toFixed(1)}G` : 'CPU'}
                    </td>

                    <td className="py-3.5 px-3 text-right font-mono text-amber-300 whitespace-nowrap">
                      ${Number(log.estimatedCost || 0).toFixed(4)}
                    </td>

                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <span
                        className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          log.status === 'failed'
                            ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                            : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                        }`}
                      >
                        {log.status === 'failed' ? 'Failed' : 'Success'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-[#18233c] bg-[#0b1222] flex items-center justify-between text-xs text-slate-400">
            <span>
              Trang {safePage} / {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 rounded-lg border border-[#223254] bg-[#111a30] hover:bg-[#1a2745] text-slate-200 disabled:opacity-40 transition"
              >
                Trước
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1 rounded-lg border border-[#223254] bg-[#111a30] hover:bg-[#1a2745] text-slate-200 disabled:opacity-40 transition"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>

      <UsageLogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  );
}

