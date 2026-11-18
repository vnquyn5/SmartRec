import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ActiveModelControlCard from '../../components/governance/ActiveModelControlCard';
import ModelRegistryPanel from '../../components/governance/ModelRegistryPanel';
import AiUsageDashboard from '../../components/governance/AiUsageDashboard';
import {
  deleteCustomModel,
  getAiUsageDashboard,
  getGovernancePolicy,
  getGovernanceSnapshotSync,
  getModelRegistry,
  resetGovernanceDefaults,
  saveGovernancePolicy,
  saveModelEntry,
  setActiveModel,
  toggleGeminiFallback,
  toggleModelStatus,
} from '../../services/modelGovernanceService';

const DEFAULT_USAGE_FILTERS = {
  range: '30d',
  modelName: 'ALL',
  runtime: 'ALL',
  fallbackOnly: false,
  search: '',
};

export default function ModelGovernancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'usage' ? 'usage' : 'models';
  const [activeTab, setActiveTab] = useState(initialTab);

  const [models, setModels] = useState(() => getGovernanceSnapshotSync().models);
  const [policy, setPolicy] = useState(() => getGovernanceSnapshotSync().policy);
  const [dataSource, setDataSource] = useState('local');
  const [loadingRegistry, setLoadingRegistry] = useState(false);
  const [pageNotice, setPageNotice] = useState({ type: '', message: '' });

  const [usageFilters, setUsageFilters] = useState(DEFAULT_USAGE_FILTERS);
  const [usageData, setUsageData] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(true);

  useEffect(() => {
    const paramTab = searchParams.get('tab');
    if (paramTab === 'usage' || paramTab === 'models') {
      setActiveTab(paramTab);
    }
  }, [searchParams]);

  const switchTab = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  const notify = useCallback((type, message) => {
    setPageNotice({ type, message });
    if (type === 'success') {
      setTimeout(() => {
        setPageNotice((prev) =>
          prev.message === message ? { type: '', message: '' } : prev
        );
      }, 3500);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingRegistry(true);
      const [regRes, polRes] = await Promise.all([
        getModelRegistry(),
        getGovernancePolicy(),
      ]);
      if (cancelled) return;
      setModels(regRes.models);
      setPolicy(polRes.policy);
      setDataSource(regRes.source === 'api' || polRes.source === 'api' ? 'api' : 'local');
      setLoadingRegistry(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingUsage(true);
      const res = await getAiUsageDashboard(usageFilters);
      if (cancelled) return;
      setUsageData(res);
      setLoadingUsage(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [usageFilters]);

  const handleSaveModel = useCallback(async (draft, prevIdentity) => {
    const updated = await saveModelEntry(draft, prevIdentity);
    setModels(updated);
  }, []);

  const handleToggleStatus = useCallback(async (modelName, version) => {
    const updated = await toggleModelStatus(modelName, version);
    setModels(updated);
  }, []);

  const handleDeleteModel = useCallback(async (modelName, version) => {
    const updated = await deleteCustomModel(modelName, version);
    setModels(updated);
  }, []);

  const handleSavePolicy = useCallback(async (nextPolicy) => {
    const saved = await saveGovernancePolicy(nextPolicy);
    setPolicy(saved);
  }, []);

  const handleSelectActiveModel = useCallback(
    async (stage, modelName, version) => {
      const result = await setActiveModel(stage, modelName, version);
      setModels(result.models);
      setPolicy(result.policy);
      notify('success', `Đã kích hoạt "${modelName}" làm Active Model cho stage ${stage}.`);
    },
    [notify]
  );

  const handleToggleGeminiFallback = useCallback(
    async (enabled, geminiModel) => {
      const nextPolicy = await toggleGeminiFallback(enabled, geminiModel);
      setPolicy(nextPolicy);
      notify(
        'success',
        enabled
          ? `Đã BẬT Gemini Fallback (${nextPolicy.geminiFallbackModel}).`
          : 'Đã TẮT Gemini Fallback — hệ thống chỉ chạy model Active nội bộ.'
      );
    },
    [notify]
  );

  const handleResetDefaults = useCallback(() => {
    const defaults = resetGovernanceDefaults();
    setModels(defaults.models);
    setPolicy(defaults.policy);
  }, []);

  const fallbackOn = Boolean(policy?.geminiFallbackEnabled ?? policy?.autoFallback ?? true);

  return (
    <div className="w-full flex flex-col gap-5 pb-8 text-slate-100">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#18233c]">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-white tracking-tight">
              Quản trị Model AI &amp; Thống kê Sử dụng
            </h1>
            <span
              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                dataSource === 'api'
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40'
                  : 'bg-sky-950/40 text-[#38bdf8] border-[#38bdf8]/30'
              }`}
            >
              {dataSource === 'api' ? 'Backend API Connected' : 'Local Registry & Telemetry'}
            </span>
            {policy && (
              <span
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                  fallbackOn
                    ? 'bg-amber-950/40 text-amber-300 border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 border-slate-700'
                }`}
              >
                Gemini Fallback: {fallbackOn ? 'ON' : 'OFF'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Chọn Active Model cho từng stage, bật/tắt Gemini Fallback (
            <code className="text-[#38bdf8]">local</code> /{' '}
            <code className="text-[#38bdf8]">external_api</code>), hạn mức chi phí và giám sát bảng{' '}
            <code className="text-[#38bdf8]">ai_usage</code>.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="inline-flex rounded-xl bg-[#0b1222] border border-[#1b2742] p-1 self-start md:self-auto">
          <button
            type="button"
            onClick={() => switchTab('models')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === 'models'
                ? 'bg-[#2563eb] text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Model Governance ({models.length})
          </button>
          <button
            type="button"
            onClick={() => switchTab('usage')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === 'usage'
                ? 'bg-[#2563eb] text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            AI Usage Dashboard
          </button>
        </div>
      </div>

      {pageNotice.message && (
        <div
          role={pageNotice.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs ${
            pageNotice.type === 'error'
              ? 'bg-rose-950/35 border-rose-500/40 text-rose-300'
              : 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
          }`}
        >
          <span>{pageNotice.message}</span>
          <button
            type="button"
            onClick={() => setPageNotice({ type: '', message: '' })}
            className="opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Active View */}
      {loadingRegistry && models.length === 0 ? (
        <div className="rounded-2xl border border-[#1b2640] bg-[#0c1324] p-10 text-center text-sm text-slate-400">
          Đang tải cấu hình Model Governance...
        </div>
      ) : activeTab === 'models' ? (
        <div className="flex flex-col gap-5">
          <ActiveModelControlCard
            models={models}
            policy={policy || {}}
            onSelectActiveModel={handleSelectActiveModel}
            onToggleGeminiFallback={handleToggleGeminiFallback}
          />
          <ModelRegistryPanel
            models={models}
            policy={policy}
            onSaveModel={handleSaveModel}
            onToggleStatus={handleToggleStatus}
            onSelectActiveModel={handleSelectActiveModel}
            onDeleteModel={handleDeleteModel}
            onSavePolicy={handleSavePolicy}
            onResetDefaults={handleResetDefaults}
          />
        </div>
      ) : (
        <AiUsageDashboard
          usageData={usageData}
          policy={policy}
          filters={usageFilters}
          loading={loadingUsage}
          onFiltersChange={setUsageFilters}
        />
      )}
    </div>
  );
}
