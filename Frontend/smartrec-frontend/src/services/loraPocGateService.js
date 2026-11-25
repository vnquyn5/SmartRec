import { api as httpClient } from '../lib/http/client.js';
import {
  LORA_GATE_STATUS,
  POC_TRAINING_SCOPE,
  evaluateLoRaPocGate,
  hasGovernanceAdminRole,
  validateLoRaPocProposalInput,
} from './loraPocGateEvaluator.js';

export {
  LORA_GATE_STATUS,
  POC_TRAINING_SCOPE,
  evaluateLoRaPocGate,
  hasGovernanceAdminRole,
  validateLoRaPocProposalInput,
};

export const LORA_GATE_ENDPOINTS = Object.freeze({
  status: '/admin/models/lora-poc-gate',
  proposal: '/admin/models/lora-poc-proposal',
});

function extractApiError(error, fallbackMessage) {
  const statusCode = error?.response?.status;
  const serverMessage = error?.response?.data?.message;
  if (statusCode === 401 || statusCode === 403) {
    return 'Bạn không có quyền truy cập hoặc thao tác trên cổng đánh giá LoRA/PEFT (403 Forbidden).';
  }
  if (statusCode === 404 || statusCode === 501) {
    return 'Endpoint đánh giá LoRA/PEFT chưa sẵn sàng trên Backend — giữ trạng thái Chưa xác minh (BR03).';
  }
  if (typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage.trim();
  }
  return fallbackMessage;
}

/**
 * Fetches Conditional LoRA/PEFT gate evaluation report from BE/AI.
 * Per BR03, missing API/dataset explicitly returns UNVERIFIED instead of fabricating metrics.
 */
export async function getLoRaPocGateStatus(client = httpClient) {
  try {
    const response = await client.get(LORA_GATE_ENDPOINTS.status);
    const payload = response?.report ?? response;
    const evaluation = evaluateLoRaPocGate(payload);

    if (evaluation.status === LORA_GATE_STATUS.UNVERIFIED) {
      return {
        source: 'unverified',
        evaluation,
        error: 'Backend chưa trả về dữ liệu đánh giá Task Precision/Recall hợp lệ.',
      };
    }

    return {
      source: 'api',
      evaluation,
      error: null,
    };
  } catch (error) {
    return {
      source: 'unverified',
      evaluation: evaluateLoRaPocGate(null),
      error: extractApiError(
        error,
        'Không thể tải dữ liệu đánh giá LoRA/PEFT từ Backend — giữ trạng thái Chưa xác minh.'
      ),
    };
  }
}

/**
 * Submits a conditional PoC-only proposal once all BR01/BR02/TR02 checks pass.
 * Never simulates success when Backend rejects or is unavailable.
 */
export async function submitLoRaPocProposal(
  { report, rationale, proposedAdapter, user },
  client = httpClient
) {
  const validatedPayload = validateLoRaPocProposalInput({
    report,
    rationale,
    proposedAdapter,
    user,
  });

  try {
    const response = await client.post(LORA_GATE_ENDPOINTS.proposal, validatedPayload);
    return {
      ok: true,
      data: response,
      payload: validatedPayload,
    };
  } catch (error) {
    throw new Error(
      extractApiError(
        error,
        'Không thể gửi đề xuất LoRA/PEFT PoC lên Backend. Vui lòng kiểm tra trạng thái API và thử lại.'
      )
    );
  }
}

