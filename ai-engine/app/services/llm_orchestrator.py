import logging
from typing import Optional, Dict, Any

from app.core.config import settings
from app.schemas.llm_schemas import LLMRequest, LLMResponse, AiUsagePayload
from app.services.pii_sanitizer import PIISanitizer
from app.services.llm_guard import (
    LLMGuard,
    QuotaExceededError,
    CostLimitExceededError,
    DuplicateCallbackError
)
from app.services.llm_clients import (
    LocalLLMClient,
    GeminiClient,
    LocalLLMTimeoutError,
    LocalLLMConnectionError,
    GeminiAPIError,
    FallbackDisabledError
)
from app.services.callback_client import CallbackClient

logger = logging.getLogger("smartrec.llm_orchestrator")


class LLMOrchestrator:
    """Bộ điều phối thực thi LLM với tuyến Local mặc định, Gemini fallback, bảo vệ PII và quota."""

    def __init__(
        self,
        local_client: Optional[LocalLLMClient] = None,
        gemini_client: Optional[GeminiClient] = None,
        pii_sanitizer: Optional[PIISanitizer] = None,
        llm_guard: Optional[LLMGuard] = None,
        callback_client: Optional[CallbackClient] = None,
        fallback_enabled: Optional[bool] = None
    ):
        self.local_client = local_client or LocalLLMClient()
        self.gemini_client = gemini_client or GeminiClient()
        self.pii_sanitizer = pii_sanitizer or PIISanitizer()
        self.llm_guard = llm_guard or LLMGuard()
        self.callback_client = callback_client or CallbackClient()
        self._fallback_enabled = (
            fallback_enabled if fallback_enabled is not None else settings.fallback_enabled
        )

    @property
    def fallback_enabled(self) -> bool:
        return self._fallback_enabled

    @fallback_enabled.setter
    def fallback_enabled(self, val: bool) -> None:
        self._fallback_enabled = val

    def generate(self, request: LLMRequest) -> LLMResponse:
        """Thực thi request với thứ tự ưu tiên: Local LLM -> Gemini Fallback (nếu có lỗi & đủ điều kiện)."""
        job_id = request.job_id

        # 1. Kiểm tra hạn mức số lượng request cho Job
        self.llm_guard.check_and_increment_request(job_id)

        # 2. Tuyến mặc định: Gọi Local LLM
        logger.info(f"[{job_id}] Tuyến xử lý mặc định: Bắt đầu gọi Local LLM ({self.local_client.model})...")
        try:
            local_result = self.local_client.generate(
                prompt=request.prompt,
                system_prompt=request.system_prompt,
                temperature=request.temperature,
                max_tokens=request.max_tokens
            )
            logger.info(f"[{job_id}] Local LLM hoàn thành thành công trong {local_result['processing_time_ms']}ms")
            return LLMResponse(
                job_id=job_id,
                text=local_result["text"],
                model_name=local_result["model_name"],
                model_version=local_result.get("model_version"),
                fallback_used=False,
                fallback_reason=None,
                input_tokens=local_result["input_tokens"],
                output_tokens=local_result["output_tokens"],
                total_tokens=local_result["total_tokens"],
                processing_time_ms=local_result["processing_time_ms"],
                estimated_cost_usd=0.0
            )

        except (LocalLLMTimeoutError, LocalLLMConnectionError) as local_err:
            fallback_reason = "LOCAL_TIMEOUT" if isinstance(local_err, LocalLLMTimeoutError) else "LOCAL_CONNECTION_ERROR"
            logger.warning(
                f"[{job_id}] Local LLM thất bại (reason={fallback_reason}). "
                f"Kiểm tra điều kiện fallback (enabled={self.fallback_enabled})..."
            )

            # 3. Kiểm tra điều kiện Fallback có được kích hoạt không
            if not self.fallback_enabled:
                logger.error(
                    f"[{job_id}] Fallback bị vô hiệu hóa bởi cấu hình (FALLBACK_ENABLED=False). "
                    f"Từ chối gọi Gemini. reason={fallback_reason}"
                )
                raise FallbackDisabledError(
                    f"Local LLM thất bại ({fallback_reason}) và cơ chế fallback đang bị tắt"
                ) from local_err

            # 4. Kiểm tra trước hạn mức chi phí của Job trước khi gọi dịch vụ ngoài
            self.llm_guard.check_cost_ceiling(job_id)

            # 5. Áp dụng chính sách ẩn/che PII trước khi gửi dữ liệu sang Gemini
            if not request.apply_pii_redaction and settings.pii_redaction_enforced:
                logger.warning(
                    f"[{job_id}] Request yêu cầu tắt che PII nhưng chính sách hệ thống bắt buộc che "
                    f"(PII_REDACTION_ENFORCED=True). Vẫn áp dụng che PII."
                )
            if settings.pii_redaction_enforced or request.apply_pii_redaction:
                safe_prompt = self.pii_sanitizer.redact(request.prompt)
                safe_system_prompt = (
                    self.pii_sanitizer.redact(request.system_prompt)
                    if request.system_prompt else None
                )
                detected = self.pii_sanitizer.detect_pii_types(request.prompt)
                if detected:
                    logger.info(
                        f"[{job_id}] Đã che PII trước khi gửi sang Gemini. Danh mục PII: {detected}"
                    )
            else:
                safe_prompt = request.prompt
                safe_system_prompt = request.system_prompt

            # 6. Gọi Gemini Fallback với prompt đã bảo vệ PII
            logger.info(
                f"[{job_id}] Kích hoạt Fallback sang Gemini ({self.gemini_client.model}). "
                f"Lý do: {fallback_reason}"
            )
            gemini_result = self.gemini_client.generate(
                prompt=safe_prompt,
                system_prompt=safe_system_prompt,
                temperature=request.temperature,
                max_tokens=request.max_tokens
            )

            # 7. Ghi nhận chi phí tích lũy cho Job
            cost = gemini_result.get("estimated_cost_usd", 0.0)
            self.llm_guard.record_and_check_cost(job_id, cost)

            logger.info(
                f"[{job_id}] Gemini fallback thành công: {gemini_result['total_tokens']} tokens, "
                f"chi phí ước tính: ${cost:.6f} USD"
            )

            return LLMResponse(
                job_id=job_id,
                text=gemini_result["text"],
                model_name=gemini_result["model_name"],
                model_version=gemini_result.get("model_version"),
                fallback_used=True,
                fallback_reason=fallback_reason,
                input_tokens=gemini_result["input_tokens"],
                output_tokens=gemini_result["output_tokens"],
                total_tokens=gemini_result["total_tokens"],
                processing_time_ms=gemini_result["processing_time_ms"],
                estimated_cost_usd=cost
            )

    def dispatch_usage_callback(
        self,
        job_id: str,
        execution_id: str,
        response: LLMResponse,
        callback_url: Optional[str] = None,
        internal_token: Optional[str] = None
    ) -> bool:
        """Gửi kết quả AiUsage về backend với cơ chế chống gọi lặp (Idempotency)."""
        # Kiểm tra xem callback cho cặp (job_id, execution_id) này đã được xử lý chưa
        if self.llm_guard.is_callback_processed(job_id, execution_id):
            logger.warning(
                f"[{job_id}] Callback execution_id={execution_id} đã được gửi trước đó. "
                f"Bỏ qua để tránh gọi lặp (Duplicate Callback Prevented)."
            )
            return True

        usage_payload = AiUsagePayload(
            jobId=job_id,
            modelName=response.model_name,
            modelVersion=response.model_version,
            inputTokens=response.input_tokens,
            outputTokens=response.output_tokens,
            totalTokens=response.total_tokens,
            processingTime=response.processing_time_ms,
            fallbackUsed=response.fallback_used,
            fallbackReason=response.fallback_reason,
            estimatedCost=response.estimated_cost_usd
        )

        success = True
        if callback_url:
            # Payload phẳng khớp AiUsageCallbackRequest của Backend; executionId đi qua header X-Execution-Id.
            payload_dict = usage_payload.model_dump()
            success = self.callback_client.send_callback(
                callback_url=callback_url,
                payload=payload_dict,
                job_id=job_id,
                internal_token=internal_token,
                execution_id=execution_id
            )

        if success:
            self.llm_guard.mark_callback_processed(job_id, execution_id)

        return success
