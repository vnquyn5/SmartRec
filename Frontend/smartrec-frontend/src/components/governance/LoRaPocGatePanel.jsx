import React, { useState } from 'react';
import {
  LORA_GATE_STATUS,
  POC_TRAINING_SCOPE,
  hasGovernanceAdminRole,
} from '../../services/loraPocGateEvaluator';

const STATUS_META = {
  [LORA_GATE_STATUS.UNVERIFIED]: {
    label: 'Chưa xác minh (UNVERIFIED)',
    badgeClass: 'bg-slate-900 text-slate-300 border-slate-600/60',
    bannerClass: 'bg-slate-900/80 border-slate-700/70 text-slate-200',
    summary:
      'Chưa có dữ liệu benchmark Task Precision/Recall hoặc API đánh giá từ BE/AI. Hệ thống không tạo kết quả giả (BR03).',
  },
  [LORA_GATE_STATUS.BLOCKED]: {
    label: 'Bị chặn điều kiện (BLOCKED)',
    badgeClass: 'bg-rose-950/50 text-rose-300 border-rose-500/40',
    bannerClass: 'bg-rose-950/30 border-rose-500/35 text-rose-200',
    summary:
      'Chưa thỏa mãn đầy đủ điều kiện ground truth, retention policy hoặc baseline prompt/context — chưa được phép đề xuất LoRA/PEFT.',
  },
  [LORA_GATE_STATUS.NOT_REQUIRED]: {
    label: 'Không cần LoRA/PEFT (NOT_REQUIRED)',
    badgeClass: 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40',
    bannerClass: 'bg-emerald-950/30 border-emerald-500/35 text-emerald-200',
    summary:
      'Task Precision/Recall đã đạt mục tiêu sau khi tối ưu context/prompt. Không cần thử nghiệm LoRA/PEFT theo BR01.',
  },
  [LORA_GATE_STATUS.ELIGIBLE_PENDING_APPROVAL]: {
    label: 'Đủ điều kiện xét PoC (Chờ duyệt)',
    badgeClass: 'bg-amber-950/50 text-amber-300 border-amber-500/40',
    bannerClass: 'bg-amber-950/30 border-amber-500/35 text-amber-200',
    summary:
      'Task Precision/Recall vẫn dưới ngưỡng sau tối ưu context/prompt. Quản trị viên có thể gửi đề xuất PoC giới hạn để phê duyệt.',
  },
  [LORA_GATE_STATUS.APPROVED_POC_READY]: {
    label: 'Đã duyệt PoC nhỏ (POC_ONLY)',
    badgeClass: 'bg-sky-950/50 text-[#38bdf8] border-[#38bdf8]/40',
    bannerClass: 'bg-sky-950/30 border-[#38bdf8]/35 text-sky-200',
    summary:
      'Đề xuất PoC đã được phê duyệt trong phạm vi POC_ONLY để chạy thử nghiệm cô lập; không kích hoạt production.',
  },
};

const CHECK_STATE_STYLES = {
  PASS: 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40',
  TRIGGERED: 'bg-amber-950/50 text-amber-300 border-amber-500/40',
  PENDING: 'bg-sky-950/50 text-[#38bdf8] border-[#38bdf8]/40',
  BLOCKED: 'bg-rose-950/50 text-rose-300 border-rose-500/40',
  UNVERIFIED: 'bg-slate-900 text-slate-400 border-slate-700',
};

function formatPercent(metric) {
  if (metric === null || metric === undefined || !Number.isFinite(Number(metric))) {
    return '—';
  }
  return `${(Number(metric) * 100).toFixed(1)}%`;
}

function formatDelta(delta) {
  if (delta === null || delta === undefined || !Number.isFinite(Number(delta))) {
    return 'Chưa xác minh';
  }
  const pct = (Number(delta) * 100).toFixed(1);
  return Number(delta) >= 0 ? `+${pct}% so với ngưỡng` : `${pct}% dưới ngưỡng`;
}

function MetricComparisonCard({ title, value, target, delta, belowTarget, subtitle }) {
  const valueColor =
    value === null
      ? 'text-slate-400'
      : belowTarget
        ? 'text-amber-300'
        : 'text-emerald-300';

  return (
    <div className="rounded-xl border border-[#1b2742] bg-[#090f1d] p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        {target !== undefined && (
          <span className="text-[10px] font-mono text-slate-400">
            Ngưỡng: {formatPercent(target)}
          </span>
        )}
      </div>
      <div className={`text-2xl font-bold font-mono ${valueColor}`}>
        {formatPercent(value)}
      </div>
      <div className="text-[11px] text-slate-400">
        {delta !== undefined ? formatDelta(delta) : subtitle}
      </div>
    </div>
  );
}

function GateCheckRow({ check }) {
  const pillStyle = CHECK_STATE_STYLES[check.state] || CHECK_STATE_STYLES.UNVERIFIED;
  return (
    <div className="rounded-xl border border-[#1a2642] bg-[#090f1d] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-white">{check.label}</div>
        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{check.detail}</p>
      </div>
      <span
        className={`self-start sm:self-center shrink-0 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${pillStyle}`}
      >
        {check.state}
      </span>
    </div>
  );
}

export default function LoRaPocGatePanel({
  evaluation,
  source = 'unverified',
  loading = false,
  error = null,
  user = null,
  onRefresh,
  onSubmitProposal,
}) {
  const [proposedAdapter, setProposedAdapter] = useState('qwen2.5-7b-task-lora-poc-v0');
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState({ type: '', message: '' });

  const status = evaluation?.status || LORA_GATE_STATUS.UNVERIFIED;
  const meta = STATUS_META[status] || STATUS_META[LORA_GATE_STATUS.UNVERIFIED];
  const isAdmin = hasGovernanceAdminRole(user);
  const canSubmit = Boolean(evaluation?.canProposePoc) && isAdmin && !submitting;
  const metrics = evaluation?.metrics || {};
  const gap = evaluation?.gapSummary || {};
  const checks = evaluation?.checks || [];

  const handleProposalSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setSubmitFeedback({ type: '', message: '' });
    try {
      await onSubmitProposal?.({
        report: evaluation?.report,
        rationale,
        proposedAdapter,
        user,
      });
      setSubmitFeedback({
        type: 'success',
        message: 'Đã ghi nhận đề xuất LoRA/PEFT PoC (phạm vi POC_ONLY) chờ phê duyệt.',
      });
      setRationale('');
    } catch (err) {
      setSubmitFeedback({
        type: 'error',
        message: err?.message || 'Không thể gửi đề xuất LoRA/PEFT PoC.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Status Banner */}
      <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 border-b border-[#18233c]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
              <h2 className="text-sm font-bold text-white">
                Cổng điều kiện thử nghiệm LoRA / PEFT (Conditional PoC Gate)
              </h2>
              <span
                data-testid="lora-gate-status-badge"
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${meta.badgeClass}`}
              >
                {meta.label}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-[#24365c] bg-[#090f1d] text-slate-400">
                Source: {source === 'api' ? 'Backend API' : 'Unverified (No API Data)'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1.5 pl-3.5">
              Chỉ xem xét đề xuất LoRA/PEFT PoC nhỏ khi Task Precision/Recall vẫn chưa đạt sau tối ưu context/prompt (BR01). Không mở training production.
            </p>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="self-start md:self-auto px-3.5 py-2 rounded-xl border border-[#243b6b] bg-[#13203d] hover:bg-[#1a2b50] text-xs font-semibold text-[#38bdf8] disabled:opacity-50 transition"
          >
            {loading ? 'Đang kiểm tra...' : 'Kiểm tra lại điều kiện'}
          </button>
        </div>

        <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${meta.bannerClass}`}>
          <div>{meta.summary}</div>
          {error && (
            <div className="mt-1.5 text-[11px] opacity-90 font-mono">
              Chi tiết kết nối: {error}
            </div>
          )}
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          <MetricComparisonCard
            title="Baseline Precision"
            value={metrics.baselinePrecision ?? null}
            subtitle="Trước tối ưu context/prompt"
          />
          <MetricComparisonCard
            title="Baseline Recall"
            value={metrics.baselineRecall ?? null}
            subtitle="Trước tối ưu context/prompt"
          />
          <MetricComparisonCard
            title="Prompt-Tuned Precision"
            value={metrics.optimizedPrecision ?? null}
            target={metrics.minTaskPrecision}
            delta={gap.precisionDelta}
            belowTarget={Boolean(gap.belowPrecision)}
          />
          <MetricComparisonCard
            title="Prompt-Tuned Recall"
            value={metrics.optimizedRecall ?? null}
            target={metrics.minTaskRecall}
            delta={gap.recallDelta}
            belowTarget={Boolean(gap.belowRecall)}
          />
        </div>
      </div>

      {/* Checklist & Proposal Form */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        <div className="xl:col-span-7 rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg flex flex-col gap-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 pb-2 border-b border-[#18233c]">
            <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
            4 Cổng điều kiện bắt buộc (BR01 – BR03, TR02)
          </h3>
          <div className="flex flex-col gap-2.5">
            {checks.map((check) => (
              <GateCheckRow key={check.id} check={check} />
            ))}
          </div>
        </div>

        {/* Conditional Proposal Form */}
        <form
          onSubmit={handleProposalSubmit}
          className="xl:col-span-5 rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg flex flex-col justify-between gap-4"
        >
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#18233c]">
              <h3 className="text-sm font-bold text-white">Đề xuất PoC có điều kiện</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-950/40 text-amber-300">
                Scope: {POC_TRAINING_SCOPE}
              </span>
            </div>

            {!isAdmin && (
              <div
                role="alert"
                className="rounded-xl border border-amber-500/35 bg-amber-950/25 px-3.5 py-2.5 text-[11px] text-amber-200"
              >
                Chế độ chỉ đọc (Read-only): Chỉ tài khoản quyền <strong>ADMIN</strong> mới được gửi đề xuất thử nghiệm LoRA/PEFT PoC (TR02).
              </div>
            )}

            {submitFeedback.message && (
              <div
                role={submitFeedback.type === 'error' ? 'alert' : 'status'}
                className={`rounded-xl border px-3.5 py-2.5 text-xs ${submitFeedback.type === 'error'
                    ? 'bg-rose-950/35 border-rose-500/40 text-rose-300'
                    : 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
                  }`}
              >
                {submitFeedback.message}
              </div>
            )}

            <label className="flex flex-col gap-1.5 text-xs">
              <span className="text-slate-400 font-medium">Adapter LoRA/PEFT dự kiến (PoC)</span>
              <input
                type="text"
                value={proposedAdapter}
                disabled={!canSubmit}
                onChange={(e) => setProposedAdapter(e.target.value)}
                className="h-9 px-3 rounded-lg bg-[#080e1c] border border-[#24365c] text-xs text-slate-100 disabled:opacity-50 focus:outline-none focus:border-[#38bdf8]"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-xs">
              <span className="text-slate-400 font-medium">
                Lý do &amp; Căn cứ từ kết quả Task Precision/Recall
              </span>
              <textarea
                rows={4}
                value={rationale}
                disabled={!canSubmit}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Ghi rõ lý do Task Precision/Recall chưa đạt sau tối ưu context/prompt và giới hạn phạm vi PoC..."
                className="p-3 rounded-lg bg-[#080e1c] border border-[#24365c] text-xs text-slate-100 placeholder-slate-500 disabled:opacity-50 focus:outline-none focus:border-[#38bdf8]"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#141d33] disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold transition"
          >
            {submitting
              ? 'Đang gửi đề xuất...'
              : canSubmit
                ? 'Gửi đề xuất LoRA/PEFT PoC (Chờ duyệt)'
                : 'Đề xuất PoC đang bị khóa (chưa đủ điều kiện)'}
          </button>
        </form>
      </div>
    </div>
  );
}

