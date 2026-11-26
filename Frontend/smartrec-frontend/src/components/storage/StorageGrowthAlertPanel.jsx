import React, { useMemo, useState } from 'react';
import {
  DEFAULT_STORAGE_ALERT_THRESHOLDS,
  STORAGE_ALERT_CATEGORY,
  STORAGE_ALERT_SEVERITY,
  evaluateStorageHealthAlerts,
} from '../../services/storageAlertEvaluator';
import { formatBytes } from '../../services/storageAdminService';

const SEVERITY_BADGE_STYLES = {
  [STORAGE_ALERT_SEVERITY.HEALTHY]:
    'bg-emerald-950/50 text-emerald-300 border-emerald-500/40',
  [STORAGE_ALERT_SEVERITY.WARNING]:
    'bg-amber-950/50 text-amber-300 border-amber-500/40',
  [STORAGE_ALERT_SEVERITY.CRITICAL]:
    'bg-rose-950/50 text-rose-300 border-rose-500/45',
  [STORAGE_ALERT_SEVERITY.UNVERIFIED]:
    'bg-slate-800 text-slate-300 border-slate-600/60',
};

const SEVERITY_LABELS = {
  [STORAGE_ALERT_SEVERITY.HEALTHY]: 'Ổn định (HEALTHY)',
  [STORAGE_ALERT_SEVERITY.WARNING]: 'Cảnh báo (WARNING)',
  [STORAGE_ALERT_SEVERITY.CRITICAL]: 'Nghiêm trọng (CRITICAL)',
  [STORAGE_ALERT_SEVERITY.UNVERIFIED]: 'Chưa xác minh (UNVERIFIED)',
};

const CATEGORY_LABELS = {
  [STORAGE_ALERT_CATEGORY.CONNECTIVITY]: 'Kết nối Bucket',
  [STORAGE_ALERT_CATEGORY.CAPACITY]: 'Dung lượng',
  [STORAGE_ALERT_CATEGORY.ORPHAN]: 'Orphan & Rác',
  [STORAGE_ALERT_CATEGORY.GROWTH]: 'Tốc độ tăng trưởng',
  [STORAGE_ALERT_CATEGORY.INTEGRITY]: 'Toàn vẹn File',
};

const GB_BYTES = 1024 * 1024 * 1024;

export default function StorageGrowthAlertPanel({
  overview,
  orphans = [],
  loading = false,
  dataSource = 'api',
  user = null,
}) {
  const [showThresholdConfig, setShowThresholdConfig] = useState(false);
  const [quotaGbInput, setQuotaGbInput] = useState(
    () => DEFAULT_STORAGE_ALERT_THRESHOLDS.quotaBytes / GB_BYTES
  );
  const [orphanWarnPctInput, setOrphanWarnPctInput] = useState(
    () => DEFAULT_STORAGE_ALERT_THRESHOLDS.orphanWarningRatioPct
  );
  const [growthWarnPctInput, setGrowthWarnPctInput] = useState(
    () => DEFAULT_STORAGE_ALERT_THRESHOLDS.growthWarningWoWPct
  );

  const report = useMemo(
    () =>
      evaluateStorageHealthAlerts({
        overview,
        orphans,
        user,
        thresholds: {
          quotaBytes: Number(quotaGbInput || 5) * GB_BYTES,
          orphanWarningRatioPct: Number(orphanWarnPctInput || 5),
          growthWarningWoWPct: Number(growthWarnPctInput || 50),
        },
      }),
    [overview, orphans, user, quotaGbInput, orphanWarnPctInput, growthWarnPctInput]
  );

  const { status, capacity, orphanMetrics, growth, alerts, isAdmin } = report;
  const badgeStyle =
    SEVERITY_BADGE_STYLES[status] || SEVERITY_BADGE_STYLES[STORAGE_ALERT_SEVERITY.UNVERIFIED];

  const capacityBarColor =
    capacity.capacityUsagePct === null
      ? 'bg-slate-600'
      : capacity.capacityUsagePct >= report.thresholds.capacityCriticalPct
        ? 'bg-rose-500'
        : capacity.capacityUsagePct >= report.thresholds.capacityWarningPct
          ? 'bg-amber-400'
          : 'bg-emerald-400';

  return (
    <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-4 sm:p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#162038]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
            <h2 className="text-sm sm:text-base font-semibold text-white">
              Giám sát &amp; Cảnh báo Dung lượng, Orphan và Tốc độ tăng trưởng
            </h2>
            <span
              data-testid="storage-alert-status-badge"
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${badgeStyle}`}
            >
              {loading && !overview ? 'Đang đối soát...' : SEVERITY_LABELS[status]}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#090f1d] text-slate-400 border border-[#1b2742]">
              {alerts.length} cảnh báo · Auto-Purge: OFF (BR02)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 pl-3.5">
            Theo dõi hạn mức sử dụng kho, tỷ trọng orphan object trên MinIO và tốc độ tăng trưởng 7 ngày so với kỳ baseline liền trước.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowThresholdConfig((prev) => !prev)}
          className="self-start md:self-auto shrink-0 px-3.5 py-1.5 rounded-xl border border-[#243b6b] bg-[#090f1d] hover:bg-[#13203d] text-xs font-semibold text-[#38bdf8] transition"
        >
          {showThresholdConfig ? 'Ẩn ngưỡng cảnh báo' : 'Ngưỡng cảnh báo'}
        </button>
      </div>

      {/* Configurable Threshold Bar (Admin-gated per TR02) */}
      {showThresholdConfig && (
        <div className="rounded-xl border border-[#1b2742] bg-[#090f1d] p-3.5 flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-200">
              Cấu hình Ngưỡng Cảnh báo Giám sát (In-Memory Policy Preview)
            </span>
            {!isAdmin && (
              <span className="text-[11px] text-amber-300">
                Chế độ chỉ đọc (Read-only): Cần quyền ADMIN để chỉnh ngưỡng cảnh báo (TR02).
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">
                Hạn mức dung lượng giám sát (GB)
              </span>
              <input
                type="number"
                min="0.5"
                max="1000"
                step="0.5"
                disabled={!isAdmin}
                value={quotaGbInput}
                onChange={(e) => setQuotaGbInput(e.target.value)}
                className="h-8 px-2.5 rounded-lg bg-[#0c1324] border border-[#223254] text-slate-100 disabled:opacity-50 focus:outline-none focus:border-[#38bdf8]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">
                Ngưỡng WARNING tỷ lệ Orphan (%)
              </span>
              <input
                type="number"
                min="1"
                max="50"
                step="1"
                disabled={!isAdmin}
                value={orphanWarnPctInput}
                onChange={(e) => setOrphanWarnPctInput(e.target.value)}
                className="h-8 px-2.5 rounded-lg bg-[#0c1324] border border-[#223254] text-slate-100 disabled:opacity-50 focus:outline-none focus:border-[#38bdf8]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">
                Ngưỡng WARNING tăng trưởng 7 ngày (%)
              </span>
              <input
                type="number"
                min="10"
                max="500"
                step="5"
                disabled={!isAdmin}
                value={growthWarnPctInput}
                onChange={(e) => setGrowthWarnPctInput(e.target.value)}
                className="h-8 px-2.5 rounded-lg bg-[#0c1324] border border-[#223254] text-slate-100 disabled:opacity-50 focus:outline-none focus:border-[#38bdf8]"
              />
            </label>
          </div>
        </div>
      )}

      {/* 3 Core Monitoring Pillars (Capacity, Orphan Ratio, Growth Velocity) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        {/* Pillar 1: Capacity & Drift */}
        <div className="rounded-xl border border-[#1b2742] bg-[#090f1d] p-4 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              1. Hạn mức &amp; Độ lệch Kho
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              Quota: {formatBytes(capacity.quotaBytes)}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xl font-bold font-mono text-white">
              {capacity.verified ? `${capacity.capacityUsagePct}%` : '—'}
            </span>
            <span className="text-xs text-slate-300 font-mono">
              {capacity.verified
                ? `${formatBytes(capacity.effectiveUsedBytes)} / ${formatBytes(capacity.quotaBytes)}`
                : 'Chưa xác minh'}
            </span>
          </div>

          <div className="w-full h-2 rounded-full bg-[#141e36] overflow-hidden">
            <div
              className={`h-full transition-all ${capacityBarColor}`}
              style={{
                width: `${capacity.verified ? Math.min(100, Math.max(2, capacity.capacityUsagePct)) : 0}%`,
              }}
            />
          </div>

          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>
              Độ lệch MinIO vs DB:{' '}
              <strong className="text-slate-200">
                {orphanMetrics.verified ? formatBytes(orphanMetrics.storageDriftBytes) : '—'}
              </strong>
            </span>
            <span>
              Warn {report.thresholds.capacityWarningPct}% · Crit {report.thresholds.capacityCriticalPct}%
            </span>
          </div>
        </div>

        {/* Pillar 2: Orphan & Reclaimable Ratio */}
        <div className="rounded-xl border border-[#1b2742] bg-[#090f1d] p-4 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              2. Tỷ trọng Orphan &amp; Rác
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                !orphanMetrics.verified
                  ? 'border-slate-700 text-slate-400'
                  : orphanMetrics.orphanObjectCount > 0
                    ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                    : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
              }`}
            >
              {orphanMetrics.verified
                ? `${orphanMetrics.orphanObjectCount} orphan objects`
                : 'UNVERIFIED'}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`text-xl font-bold font-mono ${
                orphanMetrics.verified && orphanMetrics.orphanRatioPct >= report.thresholds.orphanWarningRatioPct
                  ? 'text-rose-300'
                  : 'text-slate-100'
              }`}
            >
              {orphanMetrics.verified ? `${orphanMetrics.orphanRatioPct}% bucket` : '—'}
            </span>
            <span className="text-xs font-mono text-slate-300">
              {orphanMetrics.verified ? formatBytes(orphanMetrics.orphanTotalSizeBytes) : '—'}
            </span>
          </div>

          <div className="text-[11px] text-slate-400 leading-relaxed">
            Tổng rác có thể thu hồi:{' '}
            <strong className="text-[#38bdf8]">
              {orphanMetrics.verified
                ? `${formatBytes(orphanMetrics.reclaimableBytes)} (${orphanMetrics.reclaimableRatioPct}%)`
                : '—'}
            </strong>
          </div>
        </div>

        {/* Pillar 3: Growth Velocity & Forecast */}
        <div className="rounded-xl border border-[#1b2742] bg-[#090f1d] p-4 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              3. Tốc độ tăng trưởng (7 ngày)
            </span>
            {growth.verified && growth.baselineComparable ? (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                  growth.weekOverWeekGrowthPct >= report.thresholds.growthWarningWoWPct
                    ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                    : 'border-emerald-500/35 bg-emerald-950/30 text-emerald-300'
                }`}
              >
                {growth.weekOverWeekGrowthPct >= 0
                  ? `+${growth.weekOverWeekGrowthPct}%`
                  : `${growth.weekOverWeekGrowthPct}%`}{' '}
                vs 7d trước
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono border border-slate-700 text-slate-400">
                {growth.verified ? 'Chưa đủ baseline 7d trước' : 'UNVERIFIED'}
              </span>
            )}
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xl font-bold font-mono text-[#38bdf8]">
              {growth.verified
                ? `+${formatBytes(growth.avgDailyGrowthBytes)}/ngày`
                : '—'}
            </span>
            <span className="text-xs text-slate-300 font-mono">
              {growth.verified ? `~${growth.avgDailyFiles} file/ngày` : 'Chưa xác minh'}
            </span>
          </div>

          <div className="text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
            <span>
              7d gần nhất:{' '}
              <strong className="text-slate-200">
                {growth.verified ? formatBytes(growth.last7dBytes) : '—'}
              </strong>{' '}
              (7d trước:{' '}
              {growth.verified && growth.prev7dBytes !== null
                ? formatBytes(growth.prev7dBytes)
                : '—'}
              )
            </span>
            <span>
              Dự báo chạm quota:{' '}
              <strong className="text-amber-300">
                {growth.verified && growth.estimatedDaysToQuota !== null
                  ? `~${growth.estimatedDaysToQuota} ngày`
                  : '—'}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Active Alerts List */}
      <div className="flex flex-col gap-2">
        {alerts.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-200 flex items-center justify-between gap-3">
            <span>
              Tất cả chỉ số dung lượng, orphan object và tốc độ tăng trưởng đều nằm trong ngưỡng an toàn.
            </span>
            <span className="text-[11px] font-mono text-emerald-300 shrink-0">
              Source: {dataSource === 'api' ? 'Live API' : 'Local Mock'}
            </span>
          </div>
        ) : (
          alerts.map((alert) => {
            const pillStyle =
              SEVERITY_BADGE_STYLES[alert.severity] ||
              SEVERITY_BADGE_STYLES[STORAGE_ALERT_SEVERITY.UNVERIFIED];
            return (
              <div
                key={alert.id}
                data-testid="storage-alert-item"
                className="rounded-xl border border-[#1b2742] bg-[#090f1d] px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 text-xs"
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${pillStyle}`}
                    >
                      {alert.severity}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#13203d] text-[#38bdf8] text-[10px] font-semibold">
                      {CATEGORY_LABELS[alert.category] || alert.category}
                    </span>
                    <span className="font-semibold text-white">{alert.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{alert.detail}</p>
                  {alert.recommendedAction && (
                    <span className="text-[11px] text-slate-400">
                      Khuyến nghị: {alert.recommendedAction}
                    </span>
                  )}
                </div>

                <span className="self-start lg:self-center shrink-0 px-2.5 py-1 rounded-lg border border-[#223254] bg-[#0c1324] text-[10px] font-mono text-slate-400 whitespace-nowrap">
                  Chỉ cảnh báo · Khóa Auto-Purge
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

