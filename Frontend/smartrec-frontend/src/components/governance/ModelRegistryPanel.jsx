import React, { useMemo, useState } from 'react';
import {
  MODEL_STAGES,
  buildRegistryExportPayload,
  getModelKey,
} from '../../services/modelGovernanceService';
import ModelFormModal from './ModelFormModal';

const STAGE_BADGE_STYLES = {
  STT: 'border-sky-500/40 bg-sky-950/40 text-sky-300',
  Diarization: 'border-indigo-500/40 bg-indigo-950/40 text-indigo-300',
  'LLM Summary': 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300',
  OCR: 'border-amber-500/40 bg-amber-950/40 text-amber-300',
};

export default function ModelRegistryPanel({
  models = [],
  policy,
  onSaveModel,
  onToggleStatus,
  onSelectActiveModel,
  onDeleteModel,
  onSavePolicy,
  onResetDefaults,
}) {
  const [stageFilter, setStageFilter] = useState('ALL');
  const [runtimeFilter, setRuntimeFilter] = useState('ALL');
  const [modalState, setModalState] = useState({ open: false, model: null });
  const [policyDraft, setPolicyDraft] = useState(policy);
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const [copiedJson, setCopiedJson] = useState(false);

  React.useEffect(() => {
    setPolicyDraft(policy);
  }, [policy]);

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (stageFilter !== 'ALL' && m.stage !== stageFilter) return false;
      if (runtimeFilter !== 'ALL' && m.runtime !== runtimeFilter) return false;
      return true;
    });
  }, [models, stageFilter, runtimeFilter]);

  const enabledCount = useMemo(
    () => models.filter((m) => m.status === 'enabled').length,
    [models]
  );
  const localCount = useMemo(
    () => models.filter((m) => m.runtime === 'local').length,
    [models]
  );

  const showMessage = (type, message) => {
    setFeedback({ type, message });
    if (type === 'success') {
      setTimeout(() => {
        setFeedback((prev) => (prev.message === message ? { type: '', message: '' } : prev));
      }, 3500);
    }
  };

  const handleToggle = async (model) => {
    try {
      await onToggleStatus?.(model.model_name, model.version);
      showMessage(
        'success',
        `Đã ${model.status === 'enabled' ? 'tắt' : 'bật'} model "${model.model_name}".`
      );
    } catch (err) {
      showMessage('error', err?.message || 'Không thể cập nhật trạng thái model.');
    }
  };

  const handleDelete = async (model) => {
    try {
      await onDeleteModel?.(model.model_name, model.version);
      showMessage('success', `Đã xóa model "${model.model_name}".`);
    } catch (err) {
      showMessage('error', err?.message || 'Không thể xóa model.');
    }
  };

  const handleSavePolicySubmit = async (e) => {
    e.preventDefault();
    try {
      await onSavePolicy?.(policyDraft);
      showMessage('success', 'Đã lưu chính sách Routing & Ngân sách AI.');
    } catch (err) {
      showMessage('error', err?.message || 'Không thể lưu chính sách.');
    }
  };

  const handleExportJson = async () => {
    const payload = JSON.stringify(buildRegistryExportPayload(models), null, 2);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      }
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
      showMessage('success', 'Đã sao chép JSON chuẩn model_registry.json vào clipboard.');
    } catch {
      showMessage('error', 'Không thể sao chép JSON vào clipboard.');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Feedback Alert */}
      {feedback.message && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs ${
            feedback.type === 'error'
              ? 'bg-rose-950/35 border-rose-500/40 text-rose-300'
              : 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback({ type: '', message: '' })}
            className="opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Routing & Budget Governance Policy Card */}
      <form
        onSubmit={handleSavePolicySubmit}
        className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-[#18233c]">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
              Chính sách Routing, Fallback & Hạn mức Chi phí
            </h3>
            <p className="text-xs text-slate-400 mt-1 pl-3.5">
              Điều phối ưu tiên Local GPU/CPU hoặc Cloud API và cảnh báo khi chi phí vượt ngưỡng.
            </p>
          </div>
          <button
            type="submit"
            className="self-start sm:self-auto px-4 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold transition shadow-sm"
          >
            Lưu chính sách
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div>
            <label htmlFor="gov-routing-mode" className="block text-slate-400 font-medium mb-1.5">
              Chiến lược ưu tiên Runtime
            </label>
            <select
              id="gov-routing-mode"
              value={policyDraft?.routingMode || 'local_first'}
              onChange={(e) =>
                setPolicyDraft((prev) => ({ ...prev, routingMode: e.target.value }))
              }
              className="w-full h-9 px-3 rounded-lg bg-[#090f1d] border border-[#223254] text-slate-200 focus:outline-none focus:border-[#38bdf8] [color-scheme:dark]"
            >
              <option value="local_first" className="bg-[#0b1325]">
                Local First (Bảo mật & Tiết kiệm)
              </option>
              <option value="cloud_first" className="bg-[#0b1325]">
                Cloud API First (Tốc độ cao)
              </option>
            </select>
          </div>

          <div>
            <label htmlFor="gov-budget-usd" className="block text-slate-400 font-medium mb-1.5">
              Ngân sách tháng tối đa (USD)
            </label>
            <input
              id="gov-budget-usd"
              type="number"
              min="1"
              step="1"
              value={policyDraft?.monthlyBudgetUsd ?? 50}
              onChange={(e) =>
                setPolicyDraft((prev) => ({ ...prev, monthlyBudgetUsd: Number(e.target.value) }))
              }
              className="w-full h-9 px-3 rounded-lg bg-[#090f1d] border border-[#223254] text-white focus:outline-none focus:border-[#38bdf8]"
            />
          </div>

          <div>
            <label htmlFor="gov-token-quota" className="block text-slate-400 font-medium mb-1.5">
              Quota Token / Tháng
            </label>
            <input
              id="gov-token-quota"
              type="number"
              min="10000"
              step="50000"
              value={policyDraft?.monthlyTokenQuota ?? 2000000}
              onChange={(e) =>
                setPolicyDraft((prev) => ({ ...prev, monthlyTokenQuota: Number(e.target.value) }))
              }
              className="w-full h-9 px-3 rounded-lg bg-[#090f1d] border border-[#223254] text-white focus:outline-none focus:border-[#38bdf8]"
            />
          </div>

          <div>
            <label htmlFor="gov-alert-threshold" className="block text-slate-400 font-medium mb-1.5">
              Ngưỡng cảnh báo ngân sách (%)
            </label>
            <input
              id="gov-alert-threshold"
              type="number"
              min="10"
              max="100"
              step="5"
              value={policyDraft?.alertThresholdPct ?? 80}
              onChange={(e) =>
                setPolicyDraft((prev) => ({ ...prev, alertThresholdPct: Number(e.target.value) }))
              }
              className="w-full h-9 px-3 rounded-lg bg-[#090f1d] border border-[#223254] text-white focus:outline-none focus:border-[#38bdf8]"
            />
          </div>
        </div>
      </form>

      {/* Model Registry Table Card */}
      <div className="rounded-2xl border border-[#1b2640] bg-[#090f1d] shadow-xl overflow-hidden">
        <div className="p-5 border-b border-[#18233c] flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[#0b1222]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-white">Model Registry Governance</h3>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#13223d] text-[#38bdf8] border border-[#233866]">
                {enabledCount}/{models.length} đang bật
              </span>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-950/40 text-emerald-300 border border-emerald-500/30">
                {localCount} Local · {models.length - localCount} Cloud
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Quản lý phiên bản, thiết bị thực thi và trạng thái hoạt động của từng AI model trong hệ thống.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportJson}
              className="px-3 py-1.5 rounded-lg border border-[#243459] bg-[#111a30] hover:bg-[#192748] text-slate-200 text-xs font-medium transition"
            >
              {copiedJson ? '✓ Đã sao chép JSON' : 'Xuất model_registry.json'}
            </button>
            <button
              type="button"
              onClick={() => {
                onResetDefaults?.();
                showMessage('success', 'Đã khôi phục cấu hình Model Registry mặc định.');
              }}
              className="px-3 py-1.5 rounded-lg border border-[#243459] bg-[#111a30] hover:bg-[#192748] text-slate-300 hover:text-amber-300 text-xs font-medium transition"
            >
              Khôi phục mặc định
            </button>
            <button
              type="button"
              onClick={() => setModalState({ open: true, model: null })}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold transition shadow-sm"
            >
              <span>+</span>
              <span>Thêm Model</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-[#152037] bg-[#0c1426] flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setStageFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg border font-medium transition ${
                stageFilter === 'ALL'
                  ? 'bg-[#1a2c50] border-[#38bdf8] text-[#38bdf8]'
                  : 'bg-[#111a30] border-[#1f2e4d] text-slate-400 hover:text-white'
              }`}
            >
              Tất cả Stage
            </button>
            {MODEL_STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                onClick={() => setStageFilter(stage)}
                className={`px-2.5 py-1 rounded-lg border font-medium transition ${
                  stageFilter === stage
                    ? 'bg-[#1a2c50] border-[#38bdf8] text-[#38bdf8]'
                    : 'bg-[#111a30] border-[#1f2e4d] text-slate-400 hover:text-white'
                }`}
              >
                {stage}
              </button>
            ))}
          </div>

          <select
            value={runtimeFilter}
            onChange={(e) => setRuntimeFilter(e.target.value)}
            aria-label="Lọc theo Runtime"
            className="ml-auto bg-[#111a30] border border-[#223254] rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#38bdf8] [color-scheme:dark]"
          >
            <option value="ALL" className="bg-[#0b1325]">Tất cả Runtime</option>
            <option value="local" className="bg-[#0b1325]">Local Runtime</option>
            <option value="external_api" className="bg-[#0b1325]">External API</option>
          </select>
        </div>

        {/* Table */}
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[900px] text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#18233d] bg-[#080e1c] text-slate-400 font-semibold uppercase tracking-wider text-[11px] whitespace-nowrap">
                <th className="py-3.5 px-5">Model & Mô tả</th>
                <th className="py-3.5 px-3">Stage</th>
                <th className="py-3.5 px-3">Version</th>
                <th className="py-3.5 px-3">Runtime</th>
                <th className="py-3.5 px-3">Device</th>
                <th className="py-3.5 px-3 text-right">Cost / 1K</th>
                <th className="py-3.5 px-3 text-center">Trạng thái</th>
                <th className="py-3.5 px-5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#152037]">
              {filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    Không có model nào khớp bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filteredModels.map((model) => {
                  const isEnabled = model.status === 'enabled';
                  const isActive =
                    policy?.activeModels?.[model.stage] ===
                    getModelKey(model.model_name, model.version);
                  return (
                    <tr
                      key={`${model.model_name}@${model.version}`}
                      data-testid="governance-model-row"
                      className={`transition ${
                        isActive ? 'bg-[#0f1d3b]/70 hover:bg-[#13254a]' : 'hover:bg-[#101a32]'
                      }`}
                    >
                      <td className="py-3.5 px-5">
                        <div className="font-mono font-bold text-white flex flex-wrap items-center gap-2">
                          <span>{model.model_name}</span>
                          {isActive && (
                            <span className="font-sans text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#2563eb]/30 text-[#38bdf8] border border-[#38bdf8]/50">
                              Active
                            </span>
                          )}
                          {model.isCore && (
                            <span className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#182746] text-slate-300 border border-[#253c6b]">
                              Core
                            </span>
                          )}
                        </div>
                        {model.description && (
                          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                            {model.description}
                          </p>
                        )}
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                            STAGE_BADGE_STYLES[model.stage] || 'border-slate-600 bg-slate-800 text-slate-300'
                          }`}
                        >
                          {model.stage}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 font-mono text-slate-300 whitespace-nowrap">
                        v{model.version}
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-medium ${
                            model.runtime === 'local'
                              ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-300'
                              : 'border-amber-500/30 bg-amber-950/30 text-amber-300'
                          }`}
                        >
                          {model.runtime === 'local' ? 'Local' : 'External API'}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 font-mono uppercase text-slate-300 whitespace-nowrap">
                        {model.device}
                      </td>

                      <td className="py-3.5 px-3 font-mono text-right text-slate-200 whitespace-nowrap">
                        {model.costPer1kTokens > 0
                          ? `$${Number(model.costPer1kTokens).toFixed(5)}`
                          : '$0.00 (Free)'}
                      </td>

                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isEnabled}
                          aria-label={`Chuyển trạng thái ${model.model_name}`}
                          onClick={() => handleToggle(model)}
                          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition ${
                            isEnabled
                              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/40'
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isEnabled ? 'bg-emerald-400' : 'bg-slate-500'
                            }`}
                          />
                          {isEnabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </td>

                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {!isActive && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await onSelectActiveModel?.(
                                    model.stage,
                                    model.model_name,
                                    model.version
                                  );
                                  showMessage(
                                    'success',
                                    `Đã đặt "${model.model_name}" làm Active Model cho ${model.stage}.`
                                  );
                                } catch (err) {
                                  showMessage(
                                    'error',
                                    err?.message || 'Không thể đặt Active Model.'
                                  );
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg border border-[#2563eb]/50 bg-[#142347] hover:bg-[#1e3468] text-[#38bdf8] hover:text-white text-[11px] font-semibold transition"
                            >
                              Đặt làm Active
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setModalState({ open: true, model })}
                            className="px-2.5 py-1 rounded-lg border border-[#24365c] bg-[#121d36] hover:bg-[#1a2b50] text-slate-200 hover:text-[#38bdf8] text-[11px] font-medium transition"
                          >
                            Cấu hình
                          </button>
                          {!model.isCore && !isActive && (
                            <button
                              type="button"
                              onClick={() => handleDelete(model)}
                              className="px-2.5 py-1 rounded-lg border border-rose-500/30 bg-rose-950/20 hover:bg-rose-950/50 text-rose-300 text-[11px] font-medium transition"
                            >
                              Xóa
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ModelFormModal
        isOpen={modalState.open}
        initialModel={modalState.model}
        onClose={() => setModalState({ open: false, model: null })}
        onSave={onSaveModel}
      />
    </div>
  );
}

