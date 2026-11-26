import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LORA_GATE_STATUS,
  POC_TRAINING_SCOPE,
  assertModelAllowedForActiveStage,
  evaluateLoRaPocGate,
  hasGovernanceAdminRole,
  validateLoRaPocProposalInput,
} from './loraPocGateEvaluator.js';

function createBaseReport(overrides = {}) {
  return {
    evaluationId: 'eval-sprint5-001',
    targetStage: 'LLM Summary',
    dataset: {
      verified: true,
      name: 'smartrec_task_gt_v1',
      sampleCount: 120,
      retentionPolicyApproved: true,
    },
    thresholds: {
      minTaskPrecision: 0.85,
      minTaskRecall: 0.8,
    },
    baselinePromptEval: {
      completed: true,
      promptVersion: 'prompt-v1.0',
      precision: 0.72,
      recall: 0.68,
      evaluatedAt: '2026-11-24T10:00:00Z',
    },
    contextPromptOptimizedEval: {
      completed: true,
      promptVersion: 'prompt-v2.1-ctx',
      precision: 0.79,
      recall: 0.75,
      evaluatedAt: '2026-11-25T09:00:00Z',
    },
    approval: {
      policyApproved: false,
      approvedBy: null,
      approvedAt: null,
      trainingScope: POC_TRAINING_SCOPE,
    },
    blockers: [],
    ...overrides,
  };
}

test('TC01: Missing or null report returns UNVERIFIED with no fabricated metrics (BR03)', () => {
  const result = evaluateLoRaPocGate(null);
  assert.equal(result.status, LORA_GATE_STATUS.UNVERIFIED);
  assert.equal(result.canProposePoc, false);
  assert.equal(result.metrics.baselinePrecision, null);
  assert.equal(result.metrics.optimizedPrecision, null);
  assert.ok(result.blockers.length >= 1);
});

test('TC02: Unverified dataset or unapproved retention policy returns BLOCKED (BR02)', () => {
  const report = createBaseReport({
    dataset: {
      verified: false,
      name: null,
      sampleCount: 0,
      retentionPolicyApproved: false,
    },
  });
  const result = evaluateLoRaPocGate(report);
  assert.equal(result.status, LORA_GATE_STATUS.BLOCKED);
  assert.equal(result.canProposePoc, false);
  assert.ok(result.blockers.some((b) => b.includes('ground truth')));
  assert.ok(result.blockers.some((b) => b.includes('retention policy')));
});

test('TC03: Missing context/prompt optimization benchmark returns BLOCKED (BR01)', () => {
  const report = createBaseReport({
    contextPromptOptimizedEval: {
      completed: false,
      promptVersion: null,
      precision: null,
      recall: null,
    },
  });
  const result = evaluateLoRaPocGate(report);
  assert.equal(result.status, LORA_GATE_STATUS.BLOCKED);
  assert.equal(result.canProposePoc, false);
});

test('TC04: Optimized prompt meeting Precision and Recall thresholds returns NOT_REQUIRED (BR01)', () => {
  const report = createBaseReport({
    contextPromptOptimizedEval: {
      completed: true,
      promptVersion: 'prompt-v2.2-ctx',
      precision: 0.88,
      recall: 0.84,
    },
  });
  const result = evaluateLoRaPocGate(report);
  assert.equal(result.status, LORA_GATE_STATUS.NOT_REQUIRED);
  assert.equal(result.canProposePoc, false);
  assert.equal(result.gapSummary.belowPrecision, false);
  assert.equal(result.gapSummary.belowRecall, false);
});

test('TC05: Optimized prompt below P/R threshold returns ELIGIBLE_PENDING_APPROVAL with deltas', () => {
  const report = createBaseReport();
  const result = evaluateLoRaPocGate(report);
  assert.equal(result.status, LORA_GATE_STATUS.ELIGIBLE_PENDING_APPROVAL);
  assert.equal(result.canProposePoc, true);
  assert.equal(result.gapSummary.belowPrecision, true);
  assert.equal(result.gapSummary.belowRecall, true);
  assert.equal(result.gapSummary.precisionDelta, -0.06);
  assert.equal(result.gapSummary.recallDelta, -0.05);
});

test('TC06: Approved PoC with POC_ONLY scope returns APPROVED_POC_READY', () => {
  const report = createBaseReport({
    approval: {
      policyApproved: true,
      approvedBy: 'Leader SmartRec',
      approvedAt: '2026-11-25T11:00:00Z',
      trainingScope: POC_TRAINING_SCOPE,
    },
  });
  const result = evaluateLoRaPocGate(report);
  assert.equal(result.status, LORA_GATE_STATUS.APPROVED_POC_READY);
  assert.equal(result.canProposePoc, false);
});

test('TC07: Production training scope is strictly rejected as BLOCKED', () => {
  const report = createBaseReport({
    approval: {
      policyApproved: true,
      approvedBy: 'Admin',
      trainingScope: 'PRODUCTION',
    },
  });
  const result = evaluateLoRaPocGate(report);
  assert.equal(result.status, LORA_GATE_STATUS.BLOCKED);
  assert.equal(result.canProposePoc, false);
  assert.ok(result.blockers.some((b) => b.includes('POC_ONLY')));
});

test('TC08: Role check & proposal input validation enforce ADMIN role and rationale (TR02)', () => {
  assert.equal(hasGovernanceAdminRole({ role: 'USER' }), false);
  assert.equal(hasGovernanceAdminRole({ role: 'ROLE_ADMIN' }), true);
  assert.equal(hasGovernanceAdminRole({ roles: ['USER', 'ADMIN'] }), true);

  const report = createBaseReport();
  assert.throws(
    () =>
      validateLoRaPocProposalInput({
        report,
        rationale: 'Task P/R thấp hơn ngưỡng sau tối ưu prompt/context.',
        proposedAdapter: 'qwen2.5-7b-task-lora-poc-v0',
        user: { role: 'USER' },
      }),
    /ADMIN/
  );

  assert.throws(
    () =>
      validateLoRaPocProposalInput({
        report,
        rationale: 'Quá ngắn',
        proposedAdapter: 'qwen2.5-7b-task-lora-poc-v0',
        user: { role: 'ADMIN' },
      }),
    /15 ký tự/
  );

  const payload = validateLoRaPocProposalInput({
    report,
    rationale: 'Task precision 79% và recall 75% vẫn dưới ngưỡng sau prompt-v2.1-ctx.',
    proposedAdapter: 'qwen2.5-7b-task-lora-poc-v0',
    user: { role: 'ADMIN' },
  });
  assert.equal(payload.trainingScope, POC_TRAINING_SCOPE);
  assert.equal(payload.evaluationId, 'eval-sprint5-001');
});

test('TC09: PoC-only adapter cannot be promoted to Active Production Model (TR03)', () => {
  assert.throws(
    () =>
      assertModelAllowedForActiveStage(
        { model_name: 'qwen2.5-7b-lora-poc', version: '0.1.0', isPocOnly: true },
        'LLM Summary'
      ),
    /PoC/
  );

  assert.doesNotThrow(() =>
    assertModelAllowedForActiveStage(
      { model_name: 'Qwen 2.5 7B-Instruct', version: '2.5.0', isPocOnly: false },
      'LLM Summary'
    )
  );
});

