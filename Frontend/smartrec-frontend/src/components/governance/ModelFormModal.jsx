import React, { useEffect, useState } from 'react';
import {
  MODEL_DEVICES,
  MODEL_RUNTIMES,
  MODEL_STAGES,
  MODEL_STATUSES,
  validateModelEntry,
} from '../../services/modelGovernanceService';

const VERSION_PRESETS = ['1.0.0', '1.5.0', '2.0.0', '2.5.0', '2.7.0', '3.0', '3.1.0', '3.5.0'];
const CUSTOM_VERSION_VALUE = '__custom__';

const EMPTY_FORM = {
  model_name: '',
  version: '1.0.0',
  runtime: 'local',
  device: 'auto',
  status: 'enabled',
  stage: 'LLM Summary',
  costPer1kTokens: 0,
  maxConcurrency: 2,
  description: '',
};

export default function ModelFormModal({
  isOpen,
  initialModel = null,
  onClose,
  onSave,
}) {
  const isEditing = Boolean(initialModel);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isCustomVersion, setIsCustomVersion] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initialModel) {
      const nextVersion = initialModel.version || '1.0.0';
      setForm({
        model_name: initialModel.model_name || '',
        version: nextVersion,
        runtime: initialModel.runtime || 'local',
        device: initialModel.device || 'auto',
        status: initialModel.status || 'enabled',
        stage: initialModel.stage || 'LLM Summary',
        costPer1kTokens: initialModel.costPer1kTokens ?? 0,
        maxConcurrency: initialModel.maxConcurrency ?? 2,
        description: initialModel.description || '',
        isCore: Boolean(initialModel.isCore),
      });
      setIsCustomVersion(!VERSION_PRESETS.includes(nextVersion));
    } else {
      setForm(EMPTY_FORM);
      setIsCustomVersion(false);
    }
    setErrors({});
    setSubmitError('');
    setSubmitting(false);
  }, [isOpen, initialModel]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (submitError) setSubmitError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const fieldErrors = validateModelEntry(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      await onSave?.(
        form,
        isEditing
          ? { model_name: initialModel.model_name, version: initialModel.version }
          : null
      );
      onClose?.();
    } catch (err) {
      setSubmitError(err?.message || 'Không thể lưu cấu hình model.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-form-modal-title"
      onClick={() => {
        if (!submitting) onClose?.();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[540px] bg-[#0c101d] border border-[#1e2742] rounded-2xl shadow-2xl p-6 relative text-left my-8"
      >
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#18233c]">
          <div>
            <h2 id="model-form-modal-title" className="text-base font-bold text-white">
              {isEditing ? 'Chỉnh sửa cấu hình Model' : 'Đăng ký Model AI mới'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Chuẩn hóa theo schema ModelRegistry (<code className="text-[#38bdf8]">model_name</code>,{' '}
              <code className="text-[#38bdf8]">version</code>,{' '}
              <code className="text-[#38bdf8]">runtime</code>,{' '}
              <code className="text-[#38bdf8]">device</code>,{' '}
              <code className="text-[#38bdf8]">status</code>).
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="w-7 h-7 rounded-full bg-[#182035] hover:bg-[#222d4a] text-slate-400 hover:text-white flex items-center justify-center transition-colors disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {submitError && (
          <div
            role="alert"
            className="mt-4 px-3.5 py-2.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs"
          >
            {submitError}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* Model Name */}
          <div className="sm:col-span-2">
            <label htmlFor="model-name-input" className="block text-slate-300 font-medium mb-1.5">
              Tên Model (model_name) <span className="text-rose-400">*</span>
            </label>
            <input
              id="model-name-input"
              type="text"
              autoFocus
              value={form.model_name}
              onChange={(e) => updateField('model_name', e.target.value)}
              placeholder="Ví dụ: faster-whisper-large-v3 hoặc gpt-4o-mini"
              className={`w-full h-10 px-3 bg-[#0f1424] border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-1 ${
                errors.model_name
                  ? 'border-rose-500 focus:ring-rose-500'
                  : 'border-[#263457] focus:border-[#38bdf8] focus:ring-[#38bdf8]'
              }`}
            />
            {errors.model_name && (
              <p className="text-[11px] text-rose-400 mt-1">{errors.model_name}</p>
            )}
          </div>

          {/* Version Dropdown */}
          <div>
            <label htmlFor="model-version-select" className="block text-slate-300 font-medium mb-1.5">
              Phiên bản (version) <span className="text-rose-400">*</span>
            </label>
            <select
              id="model-version-select"
              value={isCustomVersion ? CUSTOM_VERSION_VALUE : form.version}
              onChange={(e) => {
                const selected = e.target.value;
                if (selected === CUSTOM_VERSION_VALUE) {
                  setIsCustomVersion(true);
                  if (VERSION_PRESETS.includes(form.version)) {
                    updateField('version', '');
                  }
                } else {
                  setIsCustomVersion(false);
                  updateField('version', selected);
                }
              }}
              className={`w-full h-10 px-3 bg-[#0f1424] border rounded-lg text-white focus:outline-none focus:ring-1 [color-scheme:dark] ${
                errors.version
                  ? 'border-rose-500 focus:ring-rose-500'
                  : 'border-[#263457] focus:border-[#38bdf8] focus:ring-[#38bdf8]'
              }`}
            >
              {VERSION_PRESETS.map((ver) => (
                <option key={ver} value={ver} className="bg-[#0b1325]">
                  v{ver}
                </option>
              ))}
              <option value={CUSTOM_VERSION_VALUE} className="bg-[#0b1325] text-[#38bdf8]">
                Khác (nhập tay)...
              </option>
            </select>
            {isCustomVersion && (
              <input
                id="model-version-input"
                type="text"
                value={form.version}
                onChange={(e) => updateField('version', e.target.value)}
                placeholder="Nhập phiên bản (vd: 4.0.1)..."
                aria-label="Phiên bản tùy chỉnh"
                className={`mt-2 w-full h-9 px-3 bg-[#0f1424] border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-1 ${
                  errors.version
                    ? 'border-rose-500 focus:ring-rose-500'
                    : 'border-[#263457] focus:border-[#38bdf8] focus:ring-[#38bdf8]'
                }`}
              />
            )}
            {errors.version && (
              <p className="text-[11px] text-rose-400 mt-1">{errors.version}</p>
            )}
          </div>

          {/* Stage */}
          <div>
            <label htmlFor="model-stage-select" className="block text-slate-300 font-medium mb-1.5">
              Nhiệm vụ AI (Stage)
            </label>
            <select
              id="model-stage-select"
              value={form.stage}
              onChange={(e) => updateField('stage', e.target.value)}
              className="w-full h-10 px-3 bg-[#0f1424] border border-[#263457] focus:border-[#38bdf8] rounded-lg text-white focus:outline-none [color-scheme:dark]"
            >
              {MODEL_STAGES.map((stage) => (
                <option key={stage} value={stage} className="bg-[#0b1325]">
                  {stage}
                </option>
              ))}
            </select>
          </div>

          {/* Runtime */}
          <div>
            <label htmlFor="model-runtime-select" className="block text-slate-300 font-medium mb-1.5">
              Runtime
            </label>
            <select
              id="model-runtime-select"
              value={form.runtime}
              onChange={(e) => updateField('runtime', e.target.value)}
              className="w-full h-10 px-3 bg-[#0f1424] border border-[#263457] focus:border-[#38bdf8] rounded-lg text-white focus:outline-none [color-scheme:dark]"
            >
              {MODEL_RUNTIMES.map((rt) => (
                <option key={rt} value={rt} className="bg-[#0b1325]">
                  {rt === 'local' ? 'local (Nội bộ)' : 'external_api (Cloud API)'}
                </option>
              ))}
            </select>
          </div>

          {/* Device */}
          <div>
            <label htmlFor="model-device-select" className="block text-slate-300 font-medium mb-1.5">
              Thiết bị (device)
            </label>
            <select
              id="model-device-select"
              value={form.device}
              onChange={(e) => updateField('device', e.target.value)}
              className="w-full h-10 px-3 bg-[#0f1424] border border-[#263457] focus:border-[#38bdf8] rounded-lg text-white focus:outline-none [color-scheme:dark]"
            >
              {MODEL_DEVICES.map((dev) => (
                <option key={dev} value={dev} className="bg-[#0b1325]">
                  {dev}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label htmlFor="model-status-select" className="block text-slate-300 font-medium mb-1.5">
              Trạng thái (status)
            </label>
            <select
              id="model-status-select"
              value={form.status}
              onChange={(e) => updateField('status', e.target.value)}
              className="w-full h-10 px-3 bg-[#0f1424] border border-[#263457] focus:border-[#38bdf8] rounded-lg text-white focus:outline-none [color-scheme:dark]"
            >
              {MODEL_STATUSES.map((st) => (
                <option key={st} value={st} className="bg-[#0b1325]">
                  {st === 'enabled' ? 'enabled (Đang bật)' : 'disabled (Tạm tắt)'}
                </option>
              ))}
            </select>
          </div>

          {/* Cost per 1k tokens */}
          <div>
            <label htmlFor="model-cost-input" className="block text-slate-300 font-medium mb-1.5">
              Chi phí ước tính (USD / 1K tokens)
            </label>
            <input
              id="model-cost-input"
              type="number"
              min="0"
              step="0.00005"
              value={form.costPer1kTokens}
              onChange={(e) => updateField('costPer1kTokens', e.target.value)}
              className="w-full h-10 px-3 bg-[#0f1424] border border-[#263457] focus:border-[#38bdf8] rounded-lg text-white focus:outline-none"
            />
            {errors.costPer1kTokens && (
              <p className="text-[11px] text-rose-400 mt-1">{errors.costPer1kTokens}</p>
            )}
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <label htmlFor="model-desc-input" className="block text-slate-300 font-medium mb-1.5">
              Mô tả / Ghi chú vận hành
            </label>
            <textarea
              id="model-desc-input"
              rows={2}
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Ghi chú vai trò model hoặc điều kiện fallback..."
              className="w-full px-3 py-2 bg-[#0f1424] border border-[#263457] focus:border-[#38bdf8] rounded-lg text-white placeholder-slate-500 focus:outline-none resize-none"
            />
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-[#18233c] flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="px-5 py-2 rounded-lg border border-[#24304f] bg-[#141a2e] hover:bg-[#1a233d] text-slate-200 text-xs font-medium transition disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold shadow-lg shadow-blue-950/40 transition disabled:opacity-50"
          >
            {submitting ? 'Đang lưu...' : isEditing ? 'Cập nhật Model' : 'Thêm vào Registry'}
          </button>
        </div>
      </form>
    </div>
  );
}

