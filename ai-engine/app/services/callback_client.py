import math
import time
import logging
import requests
from typing import Dict, Any, Optional

logger = logging.getLogger("smartrec.integration.callback")

PERMANENT_AI_ROUTER_ERRORS = {
    "GEMINI_FALLBACK_DENIED",
    "GEMINI_FALLBACK_NOT_CONFIGURED",
    "GEMINI_DATA_POLICY_DENIED",
    "AI_CONTEXT_INVALID",
    "AI_MEETING_ID_MISMATCH",
    "STALE_EXECUTION_CALLBACK",
    "STALE_JOB_CALLBACK",
    "INVALID_INTERNAL_TOKEN",
}


class AIInferenceRequestError(RuntimeError):
    def __init__(self, code: str, retryable: bool):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class CallbackClient:
    """HTTP Client gửi kết quả trạng thái Stage từ AI Engine về Spring Boot."""

    def __init__(self, timeout_sec: float = 10.0, max_retries: int = 3):
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries

    def send_callback(
        self,
        callback_url: str,
        payload: Dict[str, Any],
        job_id: Optional[str] = None,
        internal_token: Optional[str] = None,
        execution_id: Optional[str] = None,
    ) -> bool:
        headers = {
            "Content-Type": "application/json",
            "X-Internal-Token": internal_token or ""
        }
        if execution_id:
            headers["X-Execution-Id"] = execution_id
        backoff_delays = [2, 5, 10]
        tag = f"[{job_id}]" if job_id else ""

        for attempt in range(self.max_retries):
            try:
                logger.info(
                    f"{tag} Gửi callback stage={payload.get('stage')} status={payload.get('status')} "
                    f"tới {callback_url} (thử lần {attempt + 1}/{self.max_retries})..."
                )
                response = requests.post(
                    callback_url,
                    json=payload,
                    headers=headers,
                    timeout=self.timeout_sec
                )

                if 200 <= response.status_code < 300:
                    logger.info(f"{tag} Callback thành công: HTTP {response.status_code}")
                    return True
                else:
                    logger.warning(
                        f"{tag} Spring Boot phản hồi lỗi HTTP {response.status_code}: {response.text}"
                    )
            except requests.RequestException as e:
                logger.warning(f"{tag} Lỗi kết nối khi gửi callback: {e}")

            if attempt < self.max_retries - 1:
                time.sleep(backoff_delays[attempt])

        logger.error(f"{tag} Không thể gửi callback sau {self.max_retries} lần thử.")
        return False

    def send_ocr_metadata(self, backend_base_url, payload, *, internal_token,
                          execution_id, checkpoint):
        """Retry transient delivery only, checking execution before every write."""
        from app.workers.processing_errors import RetryableProcessingError, NonRetryableProcessingError
        url = f"{backend_base_url.rstrip('/')}/meetings/{payload['meetingId']}/slides/metadata"
        for attempt in range(self.max_retries):
            checkpoint()
            try:
                response = requests.post(url, json=payload, headers={
                    "X-Internal-Token": internal_token,
                    "X-Execution-Id": str(execution_id),
                }, timeout=self.timeout_sec)
                if 200 <= response.status_code < 300:
                    return
                if 400 <= response.status_code < 500 and response.status_code not in {408, 429}:
                    # Never publish further slides or request inference after rejection.
                    checkpoint()
                    raise NonRetryableProcessingError("OCR_METADATA_REJECTED", f"OCR metadata HTTP {response.status_code}")
            except requests.RequestException:
                pass
            if attempt + 1 < self.max_retries:
                time.sleep(min(2 ** attempt, 5))
        raise RetryableProcessingError("OCR_METADATA_DELIVERY_FAILED")

    def send_ai_usage(
        self,
        backend_base_url: str,
        payload: Dict[str, Any],
        internal_token: Optional[str] = None,
    ) -> bool:
        """Send one inference usage event; callers should reuse requestId on retries."""
        headers = {
            "Content-Type": "application/json",
            "X-Internal-Token": internal_token or "",
        }
        tag = f"[AI usage {payload.get('requestId', '<unknown>')}]"
        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    f"{backend_base_url.rstrip('/')}/internal/ai-usage",
                    json=payload,
                    headers=headers,
                    timeout=self.timeout_sec,
                )
                if 200 <= response.status_code < 300:
                    return True
                logger.warning("%s Backend rejected usage event (HTTP %s)", tag, response.status_code)
            except requests.RequestException as exc:
                # Do not log exception text: HTTP libraries can include sensitive request details.
                logger.warning("%s Could not deliver usage event (%s)", tag, type(exc).__name__)
            if attempt < self.max_retries - 1:
                time.sleep([2, 5, 10][min(attempt, 2)])
        logger.error("%s Usage event delivery failed after retries", tag)
        return False

    def send_stt_result(
        self,
        backend_base_url: str,
        payload: Dict[str, Any],
        internal_token: Optional[str] = None,
        execution_id: Optional[str] = None,
    ) -> bool:
        """Deliver STT transcript to the Backend internal endpoint."""
        from urllib.parse import urlsplit, urlunsplit

        if not internal_token or not internal_token.strip():
            logger.error("STT callback rejected: internal token is missing")
            return False

        parsed = urlsplit(backend_base_url.strip())

        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path.rstrip("/") not in {"", "/api/v1"}
        ):
            raise ValueError("Invalid Backend base URL for STT callback")

        # Preserve Spring's servlet context path. A host-only base remains
        # valid for deployments configured without a servlet context path.
        callback_url = urlunsplit((
            parsed.scheme,
            parsed.netloc,
            parsed.path.rstrip("/") + "/internal/stt/callback",
            "",
            "",
        ))

        headers = {
            "Content-Type": "application/json",
            "X-Internal-Token": internal_token,
        }

        if execution_id is not None:
            headers["X-Execution-Id"] = str(execution_id)

        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    callback_url,
                    json=payload,
                    headers=headers,
                    timeout=self.timeout_sec,
                )

                if 200 <= response.status_code < 300:
                    return True

                logger.warning(
                    "STT callback HTTP %s (attempt %s/%s)",
                    response.status_code,
                    attempt + 1,
                    self.max_retries,
                )

                # Permanent client/authentication errors should not retry.
                if 400 <= response.status_code < 500 and response.status_code != 429:
                    return False

            except requests.RequestException as exc:
                logger.warning(
                    "STT callback transport failure: %s",
                    type(exc).__name__,
                )

            if attempt < self.max_retries - 1:
                time.sleep([2, 5, 10][min(attempt, 2)])

        logger.error("STT callback delivery failed after retries")
        return False

    def request_ai_result(
        self,
        backend_base_url: str,
        job_id: str,
        internal_token: Optional[str],
        execution_id: str,
        timeout_sec: float = 900.0,
    ) -> Dict[str, Any]:
        """Ask Spring's AIModelRouter to generate and validate a Job result."""
        from urllib.parse import urlsplit, urlunsplit
        from uuid import UUID

        if not internal_token or not internal_token.strip():
            raise AIInferenceRequestError("INTERNAL_AUTH_NOT_CONFIGURED", False)
        try:
            normalized_job_id = str(UUID(str(job_id)))
            normalized_execution_id = str(UUID(str(execution_id)))
        except (TypeError, ValueError, AttributeError) as exc:
            raise AIInferenceRequestError("AI_REQUEST_ID_INVALID", False) from exc

        try:
            parsed = urlsplit(backend_base_url.strip())
            parsed.port
        except ValueError as exc:
            raise AIInferenceRequestError("BACKEND_BASE_URL_INVALID", False) from exc
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path.rstrip("/") not in {"", "/api/v1"}
        ):
            raise AIInferenceRequestError("BACKEND_BASE_URL_INVALID", False)
        if not math.isfinite(timeout_sec) or timeout_sec <= 0:
            raise AIInferenceRequestError("AI_REQUEST_TIMEOUT_INVALID", False)

        inference_url = urlunsplit((
            parsed.scheme,
            parsed.netloc,
            parsed.path.rstrip("/") + f"/internal/jobs/{normalized_job_id}/ai-result",
            "",
            "",
        ))
        headers = {
            "Content-Type": "application/json",
            "X-Internal-Token": internal_token,
            "X-Execution-Id": normalized_execution_id,
        }
        try:
            response = requests.post(
                inference_url,
                json={},
                headers=headers,
                timeout=timeout_sec,
                allow_redirects=False,
            )
        except requests.Timeout as exc:
            raise AIInferenceRequestError("AI_ROUTER_TIMEOUT", True) from exc
        except requests.RequestException as exc:
            raise AIInferenceRequestError("AI_ROUTER_UNAVAILABLE", True) from exc

        if not 200 <= response.status_code < 300:
            code = f"AI_ROUTER_HTTP_{response.status_code}"
            try:
                body = response.json()
                candidate = body.get("errorCode") or body.get("code")
                if isinstance(candidate, str) and candidate.replace("_", "").isalnum():
                    code = candidate.upper()
            except (ValueError, AttributeError):
                pass
            retryable = (
                response.status_code in {408, 425, 429}
                or response.status_code >= 500
            ) and code not in PERMANENT_AI_ROUTER_ERRORS
            logger.warning(
                "AI Router rejected inference request with HTTP %s (%s)",
                response.status_code,
                code,
            )
            raise AIInferenceRequestError(code, retryable)

        try:
            result = response.json()
        except ValueError as exc:
            raise AIInferenceRequestError("AI_ROUTER_INVALID_RESPONSE", False) from exc
        if not isinstance(result, dict):
            raise AIInferenceRequestError("AI_ROUTER_INVALID_RESPONSE", False)
        return result
