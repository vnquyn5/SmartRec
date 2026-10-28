import asyncio
import hmac
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.core.config import settings
from app.pipelines.nlp_pipeline import NLPPipelineOrchestrator
from app.schemas.llm_schemas import LLMRequest, LLMResponse, MeetingSummaryRequest
from app.services.llm_clients import FallbackDisabledError, GeminiAPIError
from app.services.llm_guard import (
    CostLimitExceededError,
    QuotaExceededError,
    build_llm_guard,
)
from app.services.llm_orchestrator import LLMOrchestrator

logger = logging.getLogger("smartrec.nlp_routes")


def require_internal_token(x_internal_token: Optional[str] = Header(default=None)) -> None:
    """Chỉ cho phép backend/worker nội bộ gọi (cùng cơ chế X-Internal-Token với route enqueue).

    Endpoint này tiêu tốn quota/chi phí Gemini nên không được mở công khai.
    """
    configured = settings.smartrec_internal_token
    if not configured or not x_internal_token or not hmac.compare_digest(configured, x_internal_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")


nlp_router = APIRouter(
    prefix="/nlp",
    tags=["NLP & LLM Processing"],
    dependencies=[Depends(require_internal_token)],
)
llm_orchestrator = LLMOrchestrator(llm_guard=build_llm_guard())
nlp_pipeline_orchestrator = NLPPipelineOrchestrator(orchestrator=llm_orchestrator)


def _map_llm_error(err: Exception) -> HTTPException:
    if isinstance(err, QuotaExceededError):
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"status": "FAILED", "code": "QUOTA_EXCEEDED", "message": str(err)},
        )
    if isinstance(err, CostLimitExceededError):
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"status": "FAILED", "code": "COST_LIMIT_EXCEEDED", "message": str(err)},
        )
    if isinstance(err, FallbackDisabledError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "FAILED", "code": "FALLBACK_DISABLED", "message": str(err)},
        )
    if isinstance(err, GeminiAPIError):
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"status": "FAILED", "code": "EXTERNAL_LLM_ERROR", "message": str(err)},
        )
    logger.exception("Lỗi trong LLM endpoint")
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"status": "FAILED", "message": f"Lỗi xử lý LLM: {str(err)}"},
    )


@nlp_router.post(
    "/generate",
    response_model=LLMResponse,
    summary="Sinh phản hồi LLM với Local ưu tiên, Gemini Fallback và bảo vệ PII",
    description="Xử lý prompt ưu tiên mô hình Local, tự động fallback sang Gemini có che PII và áp quota/cost limit."
)
async def generate_llm_endpoint(request: LLMRequest):
    try:
        return await asyncio.to_thread(llm_orchestrator.generate, request)
    except (QuotaExceededError, CostLimitExceededError, FallbackDisabledError, GeminiAPIError) as err:
        raise _map_llm_error(err)
    except Exception as err:
        raise _map_llm_error(err)


@nlp_router.post(
    "/summary",
    summary="Tóm tắt cuộc họp qua Local/Gemini fallback, ghi usage và callback về Backend",
    description=(
        "Chạy pipeline tóm tắt từ transcript, lưu bản ghi AI usage và (nếu có execution_id) "
        "gửi callback `aiUsage` tới Backend `/jobs/{jobId}/ai-usage` (chống gửi lặp)."
    ),
)
async def summarize_meeting_endpoint(request: MeetingSummaryRequest):
    try:
        result, response = await asyncio.to_thread(
            nlp_pipeline_orchestrator.run_summary,
            request.job_id,
            request.transcript_text,
            request.meeting_title,
        )
    except Exception as err:
        raise _map_llm_error(err)

    callback_dispatched = False
    if request.execution_id:
        # URL luôn được dựng từ cấu hình hệ thống (không nhận từ client) để tránh SSRF.
        callback_url = f"{settings.backend_base_url.rstrip('/')}/jobs/{request.job_id}/ai-usage"
        callback_dispatched = await asyncio.to_thread(
            llm_orchestrator.dispatch_usage_callback,
            request.job_id,
            request.execution_id,
            response,
            callback_url,
            settings.smartrec_internal_token,
        )
        if not callback_dispatched:
            logger.error(f"[{request.job_id}] Không gửi được callback aiUsage về Backend")

    result["callbackDispatched"] = callback_dispatched
    return result
