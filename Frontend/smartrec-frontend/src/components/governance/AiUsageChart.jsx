import React, { useState } from 'react';

function formatCompactTokens(value) {
  const num = Number(value) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

export default function AiUsageChart({
  dailySeries = [],
  modelBreakdown = [],
  summary = {},
}) {
  const [metric, setMetric] = useState('tokens'); // 'tokens' | 'cost'
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const maxVal = Math.max(
    metric === 'cost' ? 0.005 : 1000,
    ...dailySeries.map((d) => (metric === 'cost' ? d.estimatedCost : d.totalTokens))
  );

  const totalJobs = Math.max(1, summary.totalJobs || 0);
  const localPct = Math.round(((summary.localJobs || 0) / totalJobs) * 100);
  const cloudPct = 100 - localPct;

  const hoveredPoint = hoveredIndex != null ? dailySeries[hoveredIndex] : null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      {/* Left: Daily Trend Chart */}
      <div className="xl:col-span-2 rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg flex flex-col justify-between">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#18233c]">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
              Xu hướng Tiêu thụ AI theo Ngày
            </h3>
            <p className="text-xs text-slate-400 mt-1 pl-3.5">
              Theo dõi lưu lượng Token và chi phí ước tính từ bảng{' '}
              <code className="text-[#38bdf8]">ai_usage</code>.
            </p>
          </div>

          <div className="inline-flex rounded-lg bg-[#090f1d] border border-[#1d2b4a] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMetric('tokens')}
              className={`px-3 py-1 rounded-md font-medium transition ${
                metric === 'tokens'
                  ? 'bg-[#2563eb] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Tokens
            </button>
            <button
              type="button"
              onClick={() => setMetric('cost')}
              className={`px-3 py-1 rounded-md font-medium transition ${
                metric === 'cost'
                  ? 'bg-[#2563eb] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Chi phí (USD)
            </button>
          </div>
        </div>

        {/* Hover Summary Strip */}
        <div className="mt-3 min-h-[24px] flex items-center justify-between text-[11px] text-slate-400">
          {hoveredPoint ? (
            <div className="flex flex-wrap items-center gap-3 text-slate-200">
              <span className="font-mono font-bold text-[#38bdf8]">{hoveredPoint.date}</span>
              <span>
                Tokens:{' '}
                <strong className="text-white">
                  {hoveredPoint.totalTokens.toLocaleString()}
                </strong>
              </span>
              <span>
                Chi phí:{' '}
                <strong className="text-amber-300">
                  ${hoveredPoint.estimatedCost.toFixed(5)}
                </strong>
              </span>
              <span>
                Jobs: <strong>{hoveredPoint.jobCount}</strong> ({hoveredPoint.fallbackCount} fallback)
              </span>
            </div>
          ) : (
            <span>Di chuột lên từng cột để xem chi tiết ngày đó.</span>
          )}
        </div>

        {dailySeries.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-xs text-slate-400">
            Không có dữ liệu biểu đồ cho bộ lọc hiện tại.
          </div>
        ) : (
          <div className="mt-2 w-full overflow-x-auto">
            <svg
              viewBox="0 0 640 220"
              className="w-full min-w-[440px] h-52 select-none"
              role="img"
              aria-label="Biểu đồ xu hướng AI Usage theo ngày"
            >
              {/* Horizontal Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                const y = 180 - ratio * 150;
                const val = maxVal * ratio;
                return (
                  <g key={idx}>
                    <line
                      x1="48"
                      y1={y}
                      x2="624"
                      y2={y}
                      stroke="rgba(148, 163, 184, 0.14)"
                      strokeDasharray="4 4"
                    />
                    <text
                      x="42"
                      y={y + 4}
                      textAnchor="end"
                      fill="#64748b"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {metric === 'cost'
                        ? `$${val.toFixed(3)}`
                        : formatCompactTokens(Math.round(val))}
                    </text>
                  </g>
                );
              })}

              {/* Bars */}
              {dailySeries.map((day, index) => {
                const slotW = (624 - 56) / Math.max(1, dailySeries.length);
                const barW = Math.min(36, Math.max(12, slotW * 0.55));
                const x = 56 + index * slotW + (slotW - barW) / 2;
                const rawVal = metric === 'cost' ? day.estimatedCost : day.totalTokens;
                const barH = Math.max(4, (rawVal / maxVal) * 150);
                const y = 180 - barH;
                const isHovered = hoveredIndex === index;
                const hasFallback = day.fallbackCount > 0;

                return (
                  <g
                    key={day.date}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    className="cursor-pointer"
                  >
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={barH}
                      rx="5"
                      fill={
                        isHovered
                          ? '#38bdf8'
                          : hasFallback
                          ? '#f59e0b'
                          : '#3b82f6'
                      }
                      fillOpacity={isHovered ? 0.95 : 0.78}
                    />
                    <text
                      x={x + barW / 2}
                      y="200"
                      textAnchor="middle"
                      fill={isHovered ? '#f8fafc' : '#94a3b8'}
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {day.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        <div className="mt-2 pt-2 border-t border-[#152037] flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#3b82f6]" />
            Ngày chạy thuần Local
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#f59e0b]" />
            Ngày có kích hoạt Cloud Fallback
          </span>
        </div>
      </div>

      {/* Right: Runtime Split & Model Breakdown */}
      <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg flex flex-col gap-4">
        <div className="pb-3 border-b border-[#18233c]">
          <h3 className="text-sm font-bold text-white">Phân bổ theo Model & Runtime</h3>
          <p className="text-xs text-slate-400 mt-1">
            Tỷ lệ xử lý nội bộ (Local) so với Cloud API Fallback.
          </p>
        </div>

        {/* Local vs Cloud Bar */}
        <div className="rounded-xl bg-[#090f1d] border border-[#18233c] p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-emerald-300 font-semibold">
              Local ({summary.localJobs || 0} jobs · {localPct}%)
            </span>
            <span className="text-amber-300 font-semibold">
              Cloud ({summary.cloudJobs || 0} jobs · {cloudPct}%)
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-[#152037] overflow-hidden flex">
            <div
              className="bg-emerald-500 h-full transition-all"
              style={{ width: `${localPct}%` }}
            />
            <div
              className="bg-amber-400 h-full transition-all"
              style={{ width: `${cloudPct}%` }}
            />
          </div>
        </div>

        {/* Model List */}
        <div className="space-y-3 flex-1 overflow-y-auto pr-1">
          {modelBreakdown.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">Chưa có dữ liệu model.</p>
          ) : (
            modelBreakdown.map((item) => {
              const tokenShare =
                summary.totalTokens > 0
                  ? Math.round((item.totalTokens / summary.totalTokens) * 100)
                  : 0;
              return (
                <div
                  key={item.modelName}
                  className="rounded-xl bg-[#090f1d] border border-[#162138] p-3 space-y-1.5 text-xs"
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
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      {item.jobCount} jobs · TB {item.avgProcessingTime.toFixed(1)}s
                    </span>
                    <span className="font-mono text-slate-300">
                      {item.estimatedCost > 0
                        ? `$${item.estimatedCost.toFixed(4)}`
                        : '$0.00'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

