import { api as httpClient } from '../lib/http/client.js';
import mockGovernanceData from '../mocks/mock_governance_usage.json';

const STORAGE_PREFIX = 'smartrec.governance.v1';
const MODELS_KEY = `${STORAGE_PREFIX}.models`;
const POLICY_KEY = `${STORAGE_PREFIX}.policy`;

export const MODEL_RUNTIMES = ['local', 'external_api'];
export const MODEL_DEVICES = ['cpu', 'cuda', 'auto'];
export const MODEL_STATUSES = ['enabled', 'disabled'];
export const MODEL_STAGES = ['STT', 'Diarization', 'LLM Summary', 'OCR'];
export const CORE_REQUIRED_STAGES = new Set(['STT', 'LLM Summary']);
export const GEMINI_FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-2.5-pro',
];

export function getModelKey(modelName, version) {
  return `${modelName}@${version}`;
}

function readStorageJson(key, fallback) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorageJson(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeStorageKey(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function normalizeModelEntry(raw) {
  const runtime = MODEL_RUNTIMES.includes(String(raw?.runtime || '').trim().toLowerCase())
    ? String(raw.runtime).trim().toLowerCase()
    : 'local';
  const device = MODEL_DEVICES.includes(String(raw?.device || '').trim().toLowerCase())
    ? String(raw.device).trim().toLowerCase()
    : 'auto';
  const status = String(raw?.status || '').trim().toLowerCase() === 'disabled'
    ? 'disabled'
    : 'enabled';
  const stage = MODEL_STAGES.includes(raw?.stage) ? raw.stage : 'LLM Summary';
  const cost = Number(raw?.costPer1kTokens);
  const concurrency = Number(raw?.maxConcurrency);

  return {
    model_name: String(raw?.model_name || '').trim(),
    version: String(raw?.version || '').trim(),
    runtime,
    device,
    status,
    stage,
    costPer1kTokens: Number.isFinite(cost) && cost >= 0 ? cost : 0,
    maxConcurrency: Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 2,
    isCore: Boolean(raw?.isCore),
    description: String(raw?.description || '').trim(),
  };
}

export function validateModelEntry(entry) {
  const errors = {};
  if (!String(entry?.model_name || '').trim()) {
    errors.model_name = 'Tên model không được để trống.';
  }
  if (!String(entry?.version || '').trim()) {
    errors.version = 'Phiên bản model không được để trống.';
  }
  if (!MODEL_RUNTIMES.includes(String(entry?.runtime || '').trim().toLowerCase())) {
    errors.runtime = 'Runtime phải là local hoặc external_api.';
  }
  if (!MODEL_DEVICES.includes(String(entry?.device || '').trim().toLowerCase())) {
    errors.device = 'Device phải là cpu, cuda hoặc auto.';
  }
  if (!MODEL_STATUSES.includes(String(entry?.status || '').trim().toLowerCase())) {
    errors.status = 'Status phải là enabled hoặc disabled.';
  }
  const cost = Number(entry?.costPer1kTokens ?? 0);
  if (!Number.isFinite(cost) || cost < 0) {
    errors.costPer1kTokens = 'Chi phí phải là số >= 0.';
  }
  return errors;
}

function getDefaultModels() {
  return (mockGovernanceData?.models || []).map(normalizeModelEntry);
}

function getDefaultPolicy() {
  const base = mockGovernanceData?.policy || {};
  return {
    routingMode: 'local_first',
    autoFallback: true,
    geminiFallbackEnabled: base.geminiFallbackEnabled ?? base.autoFallback ?? true,
    geminiFallbackModel: base.geminiFallbackModel || 'gemini-2.5-flash',
    piiRedactionEnforced: base.piiRedactionEnforced ?? true,
    jobMaxCostUsd: Number(base.jobMaxCostUsd) || 0.5,
    activeModels: {
      STT: 'faster-whisper-large-v3@3.0',
      Diarization: 'pyannote/speaker-diarization-3.1@3.1.0',
      'LLM Summary': 'Qwen 2.5 7B-Instruct@2.5.0',
      OCR: 'paddleocr-vl-vi@2.7.0',
      ...(base.activeModels || {}),
    },
    monthlyBudgetUsd: 50,
    alertThresholdPct: 80,
    monthlyTokenQuota: 2000000,
    ...base,
  };
}

function loadLocalPolicy() {
  const defaults = getDefaultPolicy();
  const saved = readStorageJson(POLICY_KEY, null);
  if (!saved || typeof saved !== 'object') return defaults;
  return {
    ...defaults,
    ...saved,
    activeModels: {
      ...defaults.activeModels,
      ...(saved.activeModels || {}),
    },
  };
}

export function getGovernanceSnapshotSync() {
  return {
    models: loadLocalModels(),
    policy: loadLocalPolicy(),
  };
}

function loadLocalModels() {
  const saved = readStorageJson(MODELS_KEY, null);
  return Array.isArray(saved) && saved.length > 0
    ? saved.map(normalizeModelEntry)
    : getDefaultModels();
}

export async function getModelRegistry() {
  try {
    const response = await httpClient.get('/admin/models');
    const list = Array.isArray(response) ? response : response?.models;
    if (Array.isArray(list)) {
      const normalized = list.map(normalizeModelEntry);
      return { models: normalized, source: 'api' };
    }
  } catch {
    // Graceful fallback to local config when backend governance endpoints are unavailable
  }
  return { models: loadLocalModels(), source: 'local' };
}

export async function saveModelEntry(draft, previousIdentity = null) {
  const normalized = normalizeModelEntry(draft);
  const errors = validateModelEntry(normalized);
  if (Object.keys(errors).length > 0) {
    const firstMsg = Object.values(errors)[0];
    throw new Error(firstMsg);
  }

  const current = loadLocalModels();
  const targetName = previousIdentity?.model_name || normalized.model_name;
  const targetVersion = previousIdentity?.version || normalized.version;

  const duplicate = current.find(
    (m) =>
      m.model_name === normalized.model_name &&
      m.version === normalized.version &&
      !(previousIdentity && m.model_name === targetName && m.version === targetVersion)
  );
  if (duplicate) {
    throw new Error(`Model "${normalized.model_name}" phiên bản "${normalized.version}" đã tồn tại.`);
  }

  // Guard: do not allow disabling the last active model of a core stage
  if (normalized.status === 'disabled' && CORE_REQUIRED_STAGES.has(normalized.stage)) {
    const otherEnabledInStage = current.some(
      (m) =>
        m.stage === normalized.stage &&
        m.status === 'enabled' &&
        !(m.model_name === targetName && m.version === targetVersion)
    );
    if (!otherEnabledInStage) {
      throw new Error(`Phải giữ ít nhất 1 model đang bật cho stage ${normalized.stage}.`);
    }
  }

  try {
    if (previousIdentity) {
      await httpClient.put('/admin/models', { previousIdentity, model: normalized });
    } else {
      await httpClient.post('/admin/models', normalized);
    }
  } catch {
    // Fallback to local persistence
  }

  let updated;
  if (previousIdentity) {
    updated = current.map((m) =>
      m.model_name === targetName && m.version === targetVersion ? normalized : m
    );
  } else {
    updated = [...current, normalized];
  }
  writeStorageJson(MODELS_KEY, updated);
  return updated;
}

export async function toggleModelStatus(modelName, version) {
  const current = loadLocalModels();
  const target = current.find(
    (m) => m.model_name === modelName && m.version === version
  );
  if (!target) {
    throw new Error('Không tìm thấy model cần cập nhật.');
  }

  const nextStatus = target.status === 'enabled' ? 'disabled' : 'enabled';
  const currentPolicy = loadLocalPolicy();
  const activeKeyForStage = currentPolicy.activeModels?.[target.stage];
  if (nextStatus === 'disabled' && activeKeyForStage === getModelKey(modelName, version)) {
    throw new Error(
      `Không thể tắt "${target.model_name}" vì đang được đặt làm Active Model cho stage ${target.stage}.`
    );
  }
  if (nextStatus === 'disabled' && CORE_REQUIRED_STAGES.has(target.stage)) {
    const hasAnotherEnabled = current.some(
      (m) =>
        m.stage === target.stage &&
        m.status === 'enabled' &&
        !(m.model_name === modelName && m.version === version)
    );
    if (!hasAnotherEnabled) {
      throw new Error(
        `Không thể tắt "${target.model_name}" vì đây là model duy nhất đang hoạt động ở stage ${target.stage}.`
      );
    }
  }

  try {
    await httpClient.patch('/admin/models/status', {
      model_name: modelName,
      version,
      status: nextStatus,
    });
  } catch {
    // Fallback to local persistence
  }

  const updated = current.map((m) =>
    m.model_name === modelName && m.version === version
      ? { ...m, status: nextStatus }
      : m
  );
  writeStorageJson(MODELS_KEY, updated);
  return updated;
}

export async function deleteCustomModel(modelName, version) {
  const current = loadLocalModels();
  const target = current.find(
    (m) => m.model_name === modelName && m.version === version
  );
  if (!target) return current;
  if (target.isCore) {
    throw new Error('Không thể xóa model cốt lõi mặc định của hệ thống.');
  }
  const currentPolicy = loadLocalPolicy();
  if (currentPolicy.activeModels?.[target.stage] === getModelKey(modelName, version)) {
    throw new Error(`Không thể xóa "${target.model_name}" khi đang là Active Model.`);
  }

  try {
    await httpClient.delete('/admin/models', {
      data: { model_name: modelName, version },
    });
  } catch {
    // Fallback to local persistence
  }

  const updated = current.filter(
    (m) => !(m.model_name === modelName && m.version === version)
  );
  writeStorageJson(MODELS_KEY, updated);
  return updated;
}

export async function getGovernancePolicy() {
  try {
    const response = await httpClient.get('/admin/models/policy');
    if (response && typeof response === 'object') {
      const defaults = getDefaultPolicy();
      return {
        policy: {
          ...defaults,
          ...response,
          activeModels: {
            ...defaults.activeModels,
            ...(response.activeModels || {}),
          },
        },
        source: 'api',
      };
    }
  } catch {
    // Fallback to local policy
  }
  return {
    policy: loadLocalPolicy(),
    source: 'local',
  };
}

export async function saveGovernancePolicy(policy) {
  const current = loadLocalPolicy();
  const fallbackFlag =
    policy?.geminiFallbackEnabled !== undefined
      ? Boolean(policy.geminiFallbackEnabled)
      : policy?.autoFallback !== undefined
        ? Boolean(policy.autoFallback)
        : current.geminiFallbackEnabled;

  const sanitized = {
    routingMode: policy?.routingMode === 'cloud_first' ? 'cloud_first' : 'local_first',
    autoFallback: fallbackFlag,
    geminiFallbackEnabled: fallbackFlag,
    geminiFallbackModel: String(policy?.geminiFallbackModel || current.geminiFallbackModel || 'gemini-2.5-flash').trim(),
    piiRedactionEnforced: policy?.piiRedactionEnforced !== undefined ? Boolean(policy.piiRedactionEnforced) : true,
    jobMaxCostUsd: Math.max(0.05, Number(policy?.jobMaxCostUsd ?? current.jobMaxCostUsd) || 0.5),
    activeModels: {
      ...current.activeModels,
      ...(policy?.activeModels || {}),
    },
    monthlyBudgetUsd: Math.max(1, Number(policy?.monthlyBudgetUsd ?? current.monthlyBudgetUsd) || 50),
    alertThresholdPct: Math.min(100, Math.max(10, Number(policy?.alertThresholdPct ?? current.alertThresholdPct) || 80)),
    monthlyTokenQuota: Math.max(10000, Number(policy?.monthlyTokenQuota ?? current.monthlyTokenQuota) || 2000000),
  };

  try {
    await httpClient.put('/admin/models/policy', sanitized);
  } catch {
    // Fallback to local persistence
  }

  writeStorageJson(POLICY_KEY, sanitized);
  return sanitized;
}

export async function setActiveModel(stage, modelName, version) {
  const models = loadLocalModels();
  const target = models.find(
    (m) => m.model_name === modelName && m.version === version && m.stage === stage
  );
  if (!target) {
    throw new Error(`Không tìm thấy model "${modelName}" trong stage ${stage}.`);
  }

  // Ensure the selected active model is enabled
  const updatedModels =
    target.status === 'disabled'
      ? models.map((m) =>
        m.model_name === modelName && m.version === version
          ? { ...m, status: 'enabled' }
          : m
      )
      : models;

  const currentPolicy = loadLocalPolicy();
  const nextPolicy = {
    ...currentPolicy,
    activeModels: {
      ...currentPolicy.activeModels,
      [stage]: getModelKey(modelName, version),
    },
  };

  try {
    await httpClient.put('/admin/models/active', {
      stage,
      model_name: modelName,
      version,
    });
  } catch {
    // Fallback to local persistence
  }

  if (updatedModels !== models) {
    writeStorageJson(MODELS_KEY, updatedModels);
  }
  writeStorageJson(POLICY_KEY, nextPolicy);
  return { models: updatedModels, policy: nextPolicy };
}

export async function toggleGeminiFallback(enabled, geminiModel) {
  const currentPolicy = loadLocalPolicy();
  const nextModel = String(geminiModel || currentPolicy.geminiFallbackModel || 'gemini-2.5-flash').trim();
  const nextPolicy = {
    ...currentPolicy,
    autoFallback: Boolean(enabled),
    geminiFallbackEnabled: Boolean(enabled),
    geminiFallbackModel: nextModel,
  };

  try {
    await httpClient.put('/admin/models/fallback', {
      fallback_enabled: nextPolicy.geminiFallbackEnabled,
      gemini_model: nextPolicy.geminiFallbackModel,
    });
  } catch {
    // Fallback to local persistence
  }

  writeStorageJson(POLICY_KEY, nextPolicy);
  return nextPolicy;
}

export function resetGovernanceDefaults() {
  removeStorageKey(MODELS_KEY);
  removeStorageKey(POLICY_KEY);
  return {
    models: getDefaultModels(),
    policy: getDefaultPolicy(),
  };
}

/**
 * Exports clean registry JSON strictly matching ai-engine/model_registry.json schema.
 */
export function buildRegistryExportPayload(models = []) {
  return {
    models: models.map((m) => ({
      model_name: m.model_name,
      version: m.version,
      runtime: m.runtime,
      device: m.device,
      status: m.status,
    })),
  };
}

function getDateCutoffMs(range, referenceNowMs) {
  const dayMs = 24 * 60 * 60 * 1000;
  if (range === 'today') {
    const d = new Date(referenceNowMs);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === '7d') return referenceNowMs - 7 * dayMs;
  if (range === '30d') return referenceNowMs - 30 * dayMs;
  return 0;
}

export function aggregateAiUsage(
  rawLogs = [],
  {
    range = '30d',
    modelName = 'ALL',
    runtime = 'ALL',
    fallbackOnly = false,
    search = '',
    referenceNowMs = Date.now(),
  } = {}
) {
  const cutoffMs = getDateCutoffMs(range, referenceNowMs);
  const keyword = String(search || '').trim().toLowerCase();

  const filteredLogs = rawLogs
    .filter((log) => {
      const createdMs = new Date(log.createdAt).getTime();
      if (cutoffMs > 0 && Number.isFinite(createdMs) && createdMs < cutoffMs) {
        return false;
      }
      if (modelName !== 'ALL' && log.modelName !== modelName) return false;
      if (runtime !== 'ALL' && log.runtime !== runtime) return false;
      if (fallbackOnly && !log.fallbackUsed) return false;
      if (keyword) {
        const hay = `${log.jobId || ''} ${log.meetingTitle || ''} ${log.modelName || ''} ${log.stage || ''}`.toLowerCase();
        if (!hay.includes(keyword)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalJobs = filteredLogs.length;
  const successJobs = filteredLogs.filter((l) => l.status !== 'failed').length;
  const failedJobs = totalJobs - successJobs;
  const inputTokens = filteredLogs.reduce((s, l) => s + (Number(l.inputTokens) || 0), 0);
  const outputTokens = filteredLogs.reduce((s, l) => s + (Number(l.outputTokens) || 0), 0);
  const totalTokens = filteredLogs.reduce(
    (s, l) => s + (Number(l.totalTokens) || (Number(l.inputTokens) || 0) + (Number(l.outputTokens) || 0)),
    0
  );
  const totalCost = filteredLogs.reduce((s, l) => s + (Number(l.estimatedCost) || 0), 0);
  const fallbackCount = filteredLogs.filter((l) => Boolean(l.fallbackUsed)).length;
  const localJobs = filteredLogs.filter((l) => l.runtime === 'local').length;
  const cloudJobs = totalJobs - localJobs;

  const avgProcessingTime = totalJobs
    ? filteredLogs.reduce((s, l) => s + (Number(l.processingTime) || 0), 0) / totalJobs
    : 0;
  const cpuLogs = filteredLogs.filter((l) => l.cpuUsage != null);
  const ramLogs = filteredLogs.filter((l) => l.ramUsage != null);
  const vramLogs = filteredLogs.filter((l) => l.vramUsage != null);

  const avgCpuUsage = cpuLogs.length
    ? cpuLogs.reduce((s, l) => s + Number(l.cpuUsage), 0) / cpuLogs.length
    : 0;
  const avgRamUsage = ramLogs.length
    ? ramLogs.reduce((s, l) => s + Number(l.ramUsage), 0) / ramLogs.length
    : 0;
  const avgVramUsage = vramLogs.length
    ? vramLogs.reduce((s, l) => s + Number(l.vramUsage), 0) / vramLogs.length
    : 0;

  const localTokens = filteredLogs
    .filter((l) => l.runtime === 'local')
    .reduce((s, l) => s + (Number(l.totalTokens) || 0), 0);
  const estimatedLocalSavingsUsd = (localTokens / 1000) * 0.00035;

  // Daily series grouped by YYYY-MM-DD
  const dailyMap = new Map();
  filteredLogs.forEach((log) => {
    const dt = new Date(log.createdAt);
    if (Number.isNaN(dt.getTime())) return;
    const dateKey = dt.toISOString().slice(0, 10);
    const label = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, {
        date: dateKey,
        label,
        totalTokens: 0,
        estimatedCost: 0,
        localCost: 0,
        cloudCost: 0,
        jobCount: 0,
        fallbackCount: 0,
        localCount: 0,
        cloudCount: 0,
        _cpuSum: 0,
        _cpuCount: 0,
        _ramSum: 0,
        _ramCount: 0,
        _vramSum: 0,
        _vramCount: 0,
        _latencySum: 0,
      });
    }
    const bucket = dailyMap.get(dateKey);
    const cost = Number(log.estimatedCost) || 0;
    bucket.totalTokens += Number(log.totalTokens) || 0;
    bucket.estimatedCost += cost;
    bucket.jobCount += 1;
    bucket._latencySum += Number(log.processingTime) || 0;
    if (log.fallbackUsed) bucket.fallbackCount += 1;
    if (log.runtime === 'local') {
      bucket.localCount += 1;
      bucket.localCost += cost;
    } else {
      bucket.cloudCount += 1;
      bucket.cloudCost += cost;
    }
    if (log.cpuUsage != null) {
      bucket._cpuSum += Number(log.cpuUsage) || 0;
      bucket._cpuCount += 1;
    }
    if (log.ramUsage != null) {
      bucket._ramSum += Number(log.ramUsage) || 0;
      bucket._ramCount += 1;
    }
    if (log.vramUsage != null) {
      bucket._vramSum += Number(log.vramUsage) || 0;
      bucket._vramCount += 1;
    }
  });

  const dailySeries = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(
      ({
        _cpuSum,
        _cpuCount,
        _ramSum,
        _ramCount,
        _vramSum,
        _vramCount,
        _latencySum,
        ...rest
      }) => ({
        ...rest,
        avgCpuUsage: _cpuCount ? Number((_cpuSum / _cpuCount).toFixed(1)) : 0,
        avgRamGb: _ramCount ? Number((_ramSum / _ramCount / 1024).toFixed(2)) : 0,
        avgVramGb: _vramCount ? Number((_vramSum / _vramCount / 1024).toFixed(2)) : 0,
        avgLatency: rest.jobCount ? Number((_latencySum / rest.jobCount).toFixed(2)) : 0,
      })
    );

  // Model breakdown
  const modelMap = new Map();
  filteredLogs.forEach((log) => {
    const key = log.modelName || 'Unknown';
    if (!modelMap.has(key)) {
      modelMap.set(key, {
        modelName: key,
        runtime: log.runtime || 'local',
        stage: log.stage || 'AI',
        jobCount: 0,
        totalTokens: 0,
        estimatedCost: 0,
        totalProcessingTime: 0,
        fallbackCount: 0,
      });
    }
    const m = modelMap.get(key);
    m.jobCount += 1;
    m.totalTokens += Number(log.totalTokens) || 0;
    m.estimatedCost += Number(log.estimatedCost) || 0;
    m.totalProcessingTime += Number(log.processingTime) || 0;
    if (log.fallbackUsed) m.fallbackCount += 1;
  });

  const modelBreakdown = Array.from(modelMap.values())
    .map((m) => ({
      ...m,
      avgProcessingTime: m.jobCount ? m.totalProcessingTime / m.jobCount : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.jobCount - a.jobCount);

  return {
    summary: {
      totalJobs,
      successJobs,
      failedJobs,
      successRate: totalJobs ? (successJobs / totalJobs) * 100 : 100,
      inputTokens,
      outputTokens,
      totalTokens,
      totalCost,
      fallbackCount,
      fallbackRate: totalJobs ? (fallbackCount / totalJobs) * 100 : 0,
      localJobs,
      cloudJobs,
      avgProcessingTime,
      avgCpuUsage,
      avgRamUsage,
      avgVramUsage,
      estimatedLocalSavingsUsd,
    },
    dailySeries,
    modelBreakdown,
    logs: filteredLogs,
  };
}

export async function getAiUsageDashboard(filters = {}) {
  try {
    const response = await httpClient.get('/admin/ai-usage', { params: filters });
    const logs = Array.isArray(response) ? response : response?.logs;
    if (Array.isArray(logs)) {
      return {
        ...aggregateAiUsage(logs, filters),
        availableModels: Array.from(new Set(logs.map((l) => l.modelName).filter(Boolean))),
        source: 'api',
      };
    }
  } catch {
    // Graceful fallback to mock ai_usage telemetry
  }

  const rawLogs = Array.isArray(mockGovernanceData?.usage_logs)
    ? mockGovernanceData.usage_logs
    : [];
  return {
    ...aggregateAiUsage(rawLogs, filters),
    availableModels: Array.from(new Set(rawLogs.map((l) => l.modelName).filter(Boolean))),
    source: 'local',
  };
}

