import React, { useMemo } from 'react';
import {
  GEMINI_FALLBACK_MODELS,
  MODEL_STAGES,
  getModelKey,
} from '../../services/modelGovernanceService';

const ORDERED_STAGES = ['LLM Summary', 'STT', 'Diarization', 'OCR'];

function ChevronDownIcon({ className = 'w-3.5 h-3.5 text-slate-400 pointer-events-none' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function ActiveModelControlCard({
  models = [],
  policy = {},
  onSelectActiveModel,
  onToggleGeminiFallback,
}) {
  const activeModels = policy?.activeModels || {};
  const fallbackEnabled = Boolean(policy?.geminiFallbackEnabled ?? policy?.autoFallback ?? true);
  const fallbackModel = policy?.geminiFallbackModel || 'gemini-2.5-flash';

  const modelsByStage = useMemo(() => {
    const grouped = {};
    MODEL_STAGES.forEach((stage) => {
      grouped[stage] = models.filter((m) => m.stage === stage);
    });
    return grouped;
  }, [models]);

  const activeLlmKey = activeModels['LLM Summary'] || '';
  const activeLlm = useMemo(
    () =>
      (modelsByStage['LLM Summary'] || []).find(
        (m) => getModelKey(m.model_name, m.version) === activeLlmKey
      ) || modelsByStage['LLM Summary']?.[0],
    [modelsByStage, activeLlmKey]
  );

  const isActiveLlmGemini = /gemini/i.test(activeLlm?.model_name || '');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      {/* Left 7 cols: Active Model Selection per Stage */}
      <div className="xl:col-span-7 rounded-2xl border border-[#1b2640] bg-[#0c1324] p-5 shadow-lg flex flex-col justify-between gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#18233c]">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
              Chọn Active Model cho Pipeline AI
            </h3>
            <p className="text-xs text-slate-400 mt-1 pl-3.5">
              Chọn model mặc định đang chạy cho từng khâu xử lý (LLM Tóm tắt, STT, Diarization, OCR).
            </p>
          </div>
          {activeLlm && (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-sky-950/50 text-[#38bdf8] border border-[#38bdf8]/40">
              Active LLM: {activeLlm.model_name}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {ORDERED_STAGES.map((stage) => {
            const stageModels = modelsByStage[stage] || [];
            const selectedKey =
              activeModels[stage] ||
              (stageModels[0] ? getModelKey(stageModels[0].model_name, stageModels[0].version) : '');
            const currentModel = stageModels.find(
              (m) => getModelKey(m.model_name, m.version) === selectedKey
            );
            const isLlm = stage === 'LLM Summary';

            return (
              <div
                key={stage}
                className={`rounded-xl p-3.5 border transition ${
                  isLlm
                    ? 'bg-[#0f1a33] border-[#2563eb]/60'
                    : 'bg-[#090f1d] border-[#1a2642]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label
                    htmlFor={`active-model-${stage}`}
                    className="text-xs font-bold text-white"
                  >
                    {stage}
                  </label>
                  {currentModel && (
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        currentModel.runtime === 'local'
                          ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                          : 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                      }`}
                    >
                      {currentModel.runtime === 'local' ? 'Local' : 'Cloud API'}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <select
                    id={`active-model-${stage}`}
                    aria-label={`Chọn Active Model cho ${stage}`}
                    value={selectedKey}
                    onChange={(e) => {
                      const [name, ...verParts] = e.target.value.split('@');
                      const ver = verParts.join('@');
                      if (name && ver) {
                        onSelectActiveModel?.(stage, name, ver);
                      }
                    }}
                    className="w-full h-9 pl-3 pr-8 appearance-none rounded-lg bg-[#080e1c] border border-[#24365c] focus:border-[#38bdf8] text-xs text-slate-100 text-left focus:outline-none [color-scheme:dark] cursor-pointer"
                  >
                    {stageModels.map((m) => {
                      const key = getModelKey(m.model_name, m.version);
                      return (
                        <option key={key} value={key} className="bg-[#0b1325]">
                          {m.model_name} (v{m.version}) {m.status === 'disabled' ? '[Tắt - Tự bật]' : ''}
                        </option>
                      );
                    })}
                  </select>
                  <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right 5 cols: Gemini Fallback Toggle & Routing Flow */}
      <div
        className={`xl:col-span-5 rounded-2xl border p-5 shadow-lg flex flex-col justify-between gap-4 transition ${
          fallbackEnabled
            ? 'border-amber-500/40 bg-gradient-to-br from-[#0e162b] to-[#13192b]'
            : 'border-[#1b2640] bg-[#0c1324]'
        }`}
      >
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#18233c]">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  fallbackEnabled ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              Gemini Cloud Fallback
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Tự động chuyển sang Gemini API khi Local LLM quá tải VRAM, lỗi hoặc timeout.
            </p>
          </div>

          {/* Toggle Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={fallbackEnabled}
            aria-label="Bật hoặc tắt Gemini Fallback"
            data-testid="gemini-fallback-switch"
            onClick={() => onToggleGeminiFallback?.(!fallbackEnabled, fallbackModel)}
            className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-[#38bdf8] ${
              fallbackEnabled
                ? 'bg-amber-500/80 border-amber-400'
                : 'bg-[#152037] border-[#26365a]'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                fallbackEnabled ? 'translate-x-8' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label htmlFor="gemini-fallback-model-select" className="text-slate-300 font-medium">
                Model Gemini dự phòng
              </label>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  fallbackEnabled
                    ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {fallbackEnabled ? 'Đang bật' : 'Đang tắt'}
              </span>
            </div>
            <div className="relative">
              <select
                id="gemini-fallback-model-select"
                disabled={!fallbackEnabled}
                value={fallbackModel}
                onChange={(e) => onToggleGeminiFallback?.(fallbackEnabled, e.target.value)}
                className="w-full h-9 pl-3 pr-8 appearance-none rounded-lg bg-[#080e1c] border border-[#24365c] focus:border-[#38bdf8] text-xs text-white text-left focus:outline-none [color-scheme:dark] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                {GEMINI_FALLBACK_MODELS.map((gm) => (
                  <option key={gm} value={gm} className="bg-[#0b1325]">
                    {gm}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-md bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 font-medium">
              PII Redaction: {policy?.piiRedactionEnforced !== false ? 'Enforced' : 'Optional'}
            </span>
            <span className="px-2.5 py-1 rounded-md bg-[#111b33] border border-[#223254] text-slate-300 font-mono">
              Max Cost/Job: ${Number(policy?.jobMaxCostUsd || 0.5).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Visual Routing Flow Preview */}
        <div className="rounded-xl bg-[#080e1c] border border-[#1a2745] p-3 text-[11px]">
          <div className="text-slate-400 font-semibold uppercase tracking-wider text-[10px] mb-1.5">
            Luồng thực thi LLM hiện tại
          </div>
          {fallbackEnabled ? (
            <div className="flex flex-wrap items-center gap-1.5 text-slate-200">
              <span className="font-mono font-bold text-[#38bdf8]">
                {activeLlm?.model_name || 'Qwen 2.5 7B-Instruct'}
              </span>
              <span className="text-slate-500">→</span>
              <span className="text-slate-400">nếu lỗi/timeout</span>
              <span className="text-slate-500">→</span>
              <span className="font-mono font-bold text-amber-300">{fallbackModel}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 text-slate-300">
              <span className="font-mono font-bold text-emerald-300">
                {activeLlm?.model_name || 'Qwen 2.5 7B-Instruct'}
              </span>
              <span className="text-slate-400">· Chế độ Strict (Không fallback ra Gemini Cloud)</span>
            </div>
          )}
          {fallbackEnabled && isActiveLlmGemini && (
            <p className="text-[10px] text-amber-300/90 mt-1.5">
              Lưu ý: Bạn đang chọn Gemini làm Active Model chính; khi đổi về Local LLM, Gemini sẽ tự đóng vai trò dự phòng.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

