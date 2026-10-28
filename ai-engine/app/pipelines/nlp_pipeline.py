import logging
from typing import List, Dict, Any, Optional, Tuple

from app.schemas.llm_schemas import LLMRequest, LLMResponse
from app.services.llm_orchestrator import LLMOrchestrator

logger = logging.getLogger("smartrec.nlp_pipeline")


class NLPPipelineOrchestrator:
    """Pipeline xử lý NLP tạo biên bản tóm tắt cuộc họp và trích xuất Action Items."""

    def __init__(self, orchestrator: Optional[LLMOrchestrator] = None, usage_repository: Optional[Any] = None):
        self.orchestrator = orchestrator or LLMOrchestrator()
        # Repository ghi nhật ký ai_usage sẵn có (app.tracking). Nạp lười để không ép khởi tạo SQLite khi test.
        self._usage_repository = usage_repository

    def _persist_usage(self, response: LLMResponse) -> None:
        """Ghi usage vào nhật ký cục bộ. Fail-safe: lỗi ghi usage không được làm hỏng kết quả tóm tắt."""
        try:
            repo = self._usage_repository
            if repo is None:
                from app.tracking.storage import get_usage_repository
                repo = get_usage_repository()
            from app.tracking.contracts import AIUsageRecord
            repo.save(AIUsageRecord(
                job_id=response.job_id,
                model_name=response.model_name,
                model_version=response.model_version or "unknown",
                processing_time=round(response.processing_time_ms / 1000.0, 4),
                input_tokens=response.input_tokens,
                output_tokens=response.output_tokens,
                total_tokens=response.total_tokens,
                fallback_used=response.fallback_used,
                estimated_cost=response.estimated_cost_usd,
                status="success",
            ))
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[{response.job_id}] Không ghi được AI usage: {type(e).__name__}")

    def generate_meeting_summary(
        self,
        job_id: str,
        transcript_text: str,
        meeting_title: Optional[str] = None
    ) -> Dict[str, Any]:
        """Tạo bản tóm tắt cuộc họp kèm danh sách công việc (Action Items) qua LLM Orchestrator."""
        result, _ = self.run_summary(job_id, transcript_text, meeting_title)
        return result

    def run_summary(
        self,
        job_id: str,
        transcript_text: str,
        meeting_title: Optional[str] = None
    ) -> Tuple[Dict[str, Any], LLMResponse]:
        """Tóm tắt cuộc họp, ghi usage; trả về (kết quả JSON, LLMResponse gốc) để caller gửi callback."""
        system_prompt = (
            "Bạn là trợ lý AI chuyên nghiệp phụ trách ghi biên bản cuộc họp. "
            "Hãy tóm tắt các điểm chính và liệt kê rõ ràng các hành động cần thực hiện (Action Items) kèm người phụ trách."
        )

        title_header = f"Cuộc họp: {meeting_title}\n" if meeting_title else ""
        user_prompt = (
            f"{title_header}"
            f"Dưới đây là biên bản ghi âm cuộc họp:\n"
            f"---\n"
            f"{transcript_text}\n"
            f"---\n"
            f"Hãy tóm tắt ngắn gọn các nội dung trọng tâm và trích xuất các đầu việc cần làm."
        )

        request = LLMRequest(
            job_id=job_id,
            prompt=user_prompt,
            system_prompt=system_prompt,
            temperature=0.5,
            max_tokens=2048,
            apply_pii_redaction=True
        )

        response: LLMResponse = self.orchestrator.generate(request)
        self._persist_usage(response)

        result = {
            "jobId": job_id,
            "summaryText": response.text,
            "aiUsage": {
                "modelName": response.model_name,
                "modelVersion": response.model_version,
                "fallbackUsed": response.fallback_used,
                "fallbackReason": response.fallback_reason,
                "inputTokens": response.input_tokens,
                "outputTokens": response.output_tokens,
                "totalTokens": response.total_tokens,
                "processingTimeMs": response.processing_time_ms,
                "estimatedCostUsd": response.estimated_cost_usd
            }
        }
        return result, response
