/**
 * Pure domain evaluator and guards for Conditional LoRA/PEFT PoC Gate (Sprint 5 FE).
 * Zero browser/HTTP side effects so all business rules (BR01-BR03, TR02-TR03)
 * can be verified deterministically via unit tests.
 */

export const LORA_GATE_STATUS = Object.freeze({
  UNVERIFIED: 'UNVERIFIED',
  BLOCKED: 'BLOCKED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  ELIGIBLE_PENDING_APPROVAL: 'ELIGIBLE_PENDING_APPROVAL',
  APPROVED_POC_READY: 'APPROVED_POC_READY',
});

export const POC_TRAINING_SCOPE = 'POC_ONLY';

export const DEFAULT_TASK_PR_THRESHOLDS = Object.freeze({
  minTaskPrecision: 0.85,
  minTaskRecall: 0.8,
});

const ALLOWED_ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

function toUnitMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function toSafeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeRoleToken(role) {
  return String(role || '')
    .trim()
    .toUpperCase()
    .replace(/^ROLE_/, '');
}

/**
 * Checks whether a user object or role string holds governance admin permission (TR02).
 */
export function hasGovernanceAdminRole(userOrRole) {
  if (!userOrRole) return false;
  if (typeof userOrRole === 'string') {
    return ALLOWED_ADMIN_ROLES.has(normalizeRoleToken(userOrRole));
  }
  const candidates = [];
  if (userOrRole.role) candidates.push(userOrRole.role);
  if (Array.isArray(userOrRole.roles)) candidates.push(...userOrRole.roles);
  return candidates.some((role) => ALLOWED_ADMIN_ROLES.has(normalizeRoleToken(role)));
}

/**
 * Guard preventing unapproved/PoC-only adapters from becoming Active Production Models (TR03).
 */
export function assertModelAllowedForActiveStage(model, stage) {
  if (!model) {
    throw new Error(`Không tìm thấy model trong stage ${stage || 'hiện tại'}.`);
  }
  if (model.isPocOnly) {
    throw new Error(
      `Không thể kích hoạt "${model.model_name}" làm Active Model vì đây là model thử nghiệm PoC chưa được phê duyệt production.`
    );
  }
}

/**
 * Normalizes a raw gate report from BE/AI. Returns null when data is absent (BR03).
 */
export function normalizeLoRaGateReport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const minTaskPrecision =
    toUnitMetric(raw?.thresholds?.minTaskPrecision) ?? DEFAULT_TASK_PR_THRESHOLDS.minTaskPrecision;
  const minTaskRecall =
    toUnitMetric(raw?.thresholds?.minTaskRecall) ?? DEFAULT_TASK_PR_THRESHOLDS.minTaskRecall;

  const dataset = {
    verified: Boolean(raw?.dataset?.verified),
    name: raw?.dataset?.name ? String(raw.dataset.name).trim() : null,
    sampleCount: toSafeCount(raw?.dataset?.sampleCount),
    retentionPolicyApproved: Boolean(raw?.dataset?.retentionPolicyApproved),
  };

  const baselinePromptEval = {
    completed: Boolean(raw?.baselinePromptEval?.completed),
    promptVersion: raw?.baselinePromptEval?.promptVersion
      ? String(raw.baselinePromptEval.promptVersion).trim()
      : null,
    precision: toUnitMetric(raw?.baselinePromptEval?.precision),
    recall: toUnitMetric(raw?.baselinePromptEval?.recall),
    evaluatedAt: raw?.baselinePromptEval?.evaluatedAt || null,
  };

  const contextPromptOptimizedEval = {
    completed: Boolean(raw?.contextPromptOptimizedEval?.completed),
    promptVersion: raw?.contextPromptOptimizedEval?.promptVersion
      ? String(raw.contextPromptOptimizedEval.promptVersion).trim()
      : null,
    precision: toUnitMetric(raw?.contextPromptOptimizedEval?.precision),
    recall: toUnitMetric(raw?.contextPromptOptimizedEval?.recall),
    evaluatedAt: raw?.contextPromptOptimizedEval?.evaluatedAt || null,
  };

  const rawScope = String(raw?.approval?.trainingScope || POC_TRAINING_SCOPE)
    .trim()
    .toUpperCase();

  const approval = {
    policyApproved: Boolean(raw?.approval?.policyApproved),
    approvedBy: raw?.approval?.approvedBy ? String(raw.approval.approvedBy).trim() : null,
    approvedAt: raw?.approval?.approvedAt || null,
    trainingScope: rawScope,
  };

  const upstreamBlockers = Array.isArray(raw?.blockers)
    ? raw.blockers.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  return {
    evaluationId: raw?.evaluationId ? String(raw.evaluationId).trim() : null,
    targetStage: raw?.targetStage ? String(raw.targetStage).trim() : 'LLM Summary',
    dataset,
    thresholds: { minTaskPrecision, minTaskRecall },
    baselinePromptEval,
    contextPromptOptimizedEval,
    approval,
    upstreamBlockers,
  };
}

function buildMetricGap(actual, target) {
  if (actual === null || target === null) return null;
  return Number((actual - target).toFixed(4));
}

function dedupeStrings(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

/**
 * Evaluates Conditional LoRA/PEFT PoC readiness strictly per BR01, BR02, BR03.
 */
export function evaluateLoRaPocGate(rawReport) {
  const report = normalizeLoRaGateReport(rawReport);

  if (!report) {
    return {
      status: LORA_GATE_STATUS.UNVERIFIED,
      canProposePoc: false,
      report: null,
      checks: [
        {
          id: 'dataset_retention',
          label: 'Labeled Ground Truth & Retention Policy (BR02)',
          state: 'UNVERIFIED',
          detail: 'Chưa có dữ liệu từ API đánh giá BE/AI.',
        },
        {
          id: 'prompt_context_baseline',
          label: 'Kết quả tối ưu Context / Prompt Baseline (BR01)',
          state: 'UNVERIFIED',
          detail: 'Chưa nhận được kết quả benchmark sau tối ưu prompt/context.',
        },
        {
          id: 'task_pr_threshold',
          label: 'Đánh giá ngưỡng Task Precision / Recall (BR01)',
          state: 'UNVERIFIED',
          detail: 'Không tự sinh số liệu giả khi thiếu kết quả đánh giá thật (BR03).',
        },
        {
          id: 'poc_approval',
          label: 'Phê duyệt chính sách & Giới hạn PoC-only (TR02)',
          state: 'UNVERIFIED',
          detail: 'Chờ xác nhận điều kiện đầu vào trước khi xét phê duyệt.',
        },
      ],
      blockers: [
        'Chưa kết nối được API đánh giá (/admin/models/lora-poc-gate) hoặc thiếu dữ liệu benchmark từ BE/AI.',
        'Trạng thái giữ ở mức Chưa xác minh (BR03) — không cho phép đề xuất hoặc kích hoạt LoRA/PEFT.',
      ],
      metrics: {
        baselinePrecision: null,
        baselineRecall: null,
        optimizedPrecision: null,
        optimizedRecall: null,
        minTaskPrecision: DEFAULT_TASK_PR_THRESHOLDS.minTaskPrecision,
        minTaskRecall: DEFAULT_TASK_PR_THRESHOLDS.minTaskRecall,
      },
      gapSummary: {
        precisionDelta: null,
        recallDelta: null,
        belowPrecision: false,
        belowRecall: false,
      },
    };
  }

  const { dataset, thresholds, baselinePromptEval, contextPromptOptimizedEval, approval } = report;
  const blockers = [...report.upstreamBlockers];

  const hasVerifiedDataset = dataset.verified && dataset.sampleCount > 0;
  const hasRetentionPolicy = dataset.retentionPolicyApproved;
  const datasetGatePass = hasVerifiedDataset && hasRetentionPolicy;

  if (!hasVerifiedDataset) {
    blockers.push('Thiếu labeled ground truth dataset đã được xác minh (sampleCount > 0).');
  }
  if (!hasRetentionPolicy) {
    blockers.push('Chưa có phê duyệt retention policy & quyền xử lý dữ liệu meeting/AI outputs (BR02).');
  }

  const hasOptimizedEval =
    contextPromptOptimizedEval.completed &&
    contextPromptOptimizedEval.precision !== null &&
    contextPromptOptimizedEval.recall !== null;

  if (!hasOptimizedEval) {
    blockers.push(
      'Chưa hoàn tất đo Task Precision/Recall sau điều chỉnh context/prompt — chưa đủ căn cứ xét LoRA/PEFT (BR01).'
    );
  }

  const isPocScopeOnly = approval.trainingScope === POC_TRAINING_SCOPE;
  if (!isPocScopeOnly) {
    blockers.push(
      `Phạm vi huấn luyện "${approval.trainingScope}" không được duyệt — Sprint 5 chỉ cho phép phạm vi ${POC_TRAINING_SCOPE}.`
    );
  }

  const precisionDelta = buildMetricGap(
    contextPromptOptimizedEval.precision,
    thresholds.minTaskPrecision
  );
  const recallDelta = buildMetricGap(contextPromptOptimizedEval.recall, thresholds.minTaskRecall);
  const belowPrecision =
    hasOptimizedEval && contextPromptOptimizedEval.precision < thresholds.minTaskPrecision;
  const belowRecall =
    hasOptimizedEval && contextPromptOptimizedEval.recall < thresholds.minTaskRecall;
  const prBelowTarget = belowPrecision || belowRecall;

  let status;
  if (!datasetGatePass || !hasOptimizedEval || !isPocScopeOnly) {
    status = LORA_GATE_STATUS.BLOCKED;
  } else if (!prBelowTarget) {
    status = LORA_GATE_STATUS.NOT_REQUIRED;
  } else if (approval.policyApproved) {
    status = LORA_GATE_STATUS.APPROVED_POC_READY;
  } else {
    status = LORA_GATE_STATUS.ELIGIBLE_PENDING_APPROVAL;
  }

  const checks = [
    {
      id: 'dataset_retention',
      label: 'Labeled Ground Truth & Retention Policy (BR02)',
      state: datasetGatePass ? 'PASS' : 'BLOCKED',
      detail: datasetGatePass
        ? `Dataset "${dataset.name || 'Đã xác minh'}" (${dataset.sampleCount} mẫu) · Retention policy đã duyệt.`
        : 'Cần ground truth dataset có nhãn đã xác minh và retention policy hợp lệ.',
    },
    {
      id: 'prompt_context_baseline',
      label: 'Kết quả tối ưu Context / Prompt Baseline (BR01)',
      state: hasOptimizedEval ? 'PASS' : 'BLOCKED',
      detail: hasOptimizedEval
        ? `Đã đo phiên bản prompt ${contextPromptOptimizedEval.promptVersion || 'hiện tại'}.`
        : 'Phải hoàn tất điều chỉnh context/prompt và có số liệu P/R trước khi cân nhắc LoRA/PEFT.',
    },
    {
      id: 'task_pr_threshold',
      label: 'Đánh giá ngưỡng Task Precision / Recall (BR01)',
      state: !hasOptimizedEval ? 'BLOCKED' : prBelowTarget ? 'TRIGGERED' : 'PASS',
      detail: !hasOptimizedEval
        ? 'Chưa có số liệu để đối chiếu với ngưỡng mục tiêu.'
        : prBelowTarget
          ? 'Task Precision/Recall sau tối ưu context/prompt vẫn dưới ngưỡng → thỏa điều kiện xét PoC nhỏ.'
          : 'Task Precision/Recall đã đạt chuẩn sau tối ưu context/prompt → KHÔNG cần thử nghiệm LoRA/PEFT.',
    },
    {
      id: 'poc_approval',
      label: 'Phê duyệt chính sách & Giới hạn PoC-only (TR02)',
      state: !isPocScopeOnly
        ? 'BLOCKED'
        : status === LORA_GATE_STATUS.APPROVED_POC_READY
          ? 'PASS'
          : status === LORA_GATE_STATUS.ELIGIBLE_PENDING_APPROVAL
            ? 'PENDING'
            : 'BLOCKED',
      detail: !isPocScopeOnly
        ? 'Không mở training production; chỉ chấp nhận phạm vi POC_ONLY.'
        : approval.policyApproved
          ? `Đã phê duyệt PoC${approval.approvedBy ? ` bởi ${approval.approvedBy}` : ''} (phạm vi POC_ONLY).`
          : 'Chờ phê duyệt chính thức từ owner trước khi AI thực thi PoC nhỏ.',
    },
  ];

  return {
    status,
    canProposePoc: status === LORA_GATE_STATUS.ELIGIBLE_PENDING_APPROVAL,
    report,
    checks,
    blockers: dedupeStrings(blockers),
    metrics: {
      baselinePrecision: baselinePromptEval.precision,
      baselineRecall: baselinePromptEval.recall,
      optimizedPrecision: contextPromptOptimizedEval.precision,
      optimizedRecall: contextPromptOptimizedEval.recall,
      minTaskPrecision: thresholds.minTaskPrecision,
      minTaskRecall: thresholds.minTaskRecall,
    },
    gapSummary: {
      precisionDelta,
      recallDelta,
      belowPrecision,
      belowRecall,
    },
  };
}

/**
 * Validates authorization and business preconditions before sending a PoC proposal (TR02, BR01).
 */
export function validateLoRaPocProposalInput({ report, rationale, proposedAdapter, user }) {
  if (!hasGovernanceAdminRole(user)) {
    throw new Error('Chỉ tài khoản quản trị (ADMIN) mới có quyền gửi đề xuất thử nghiệm LoRA/PEFT PoC.');
  }

  const evaluation = evaluateLoRaPocGate(report);
  if (!evaluation.canProposePoc) {
    throw new Error(
      `Không thể gửi đề xuất PoC khi trạng thái cổng điều kiện đang là "${evaluation.status}".`
    );
  }

  const cleanRationale = String(rationale || '').trim();
  if (cleanRationale.length < 15) {
    throw new Error('Vui lòng nhập lý do kỹ thuật tối thiểu 15 ký tự dựa trên kết quả đo Task Precision/Recall.');
  }

  const cleanAdapter = String(proposedAdapter || '').trim();
  if (!cleanAdapter) {
    throw new Error('Vui lòng chọn hoặc nhập tên phương án adapter LoRA/PEFT dự kiến cho PoC.');
  }

  return {
    evaluationId: evaluation.report?.evaluationId || null,
    targetStage: evaluation.report?.targetStage || 'LLM Summary',
    trainingScope: POC_TRAINING_SCOPE,
    proposedAdapter: cleanAdapter,
    rationale: cleanRationale,
    measuredMetrics: {
      optimizedPrecision: evaluation.metrics.optimizedPrecision,
      optimizedRecall: evaluation.metrics.optimizedRecall,
      minTaskPrecision: evaluation.metrics.minTaskPrecision,
      minTaskRecall: evaluation.metrics.minTaskRecall,
    },
  };
}

