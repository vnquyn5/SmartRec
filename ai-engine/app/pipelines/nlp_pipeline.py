"""Provider routing for structured NLP inference.

Provider clients and the task-specific output validator are injected by callers;
this module deliberately does not choose endpoints, prompts, schemas, or data
sharing policy for the application.
"""

import json
import logging
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Callable, Mapping, Optional
from uuid import uuid4

from app.tracking.token_counter import TokenCounter

logger = logging.getLogger("smartrec.ai_model_router")


class AIModelRoutingError(RuntimeError):
    """Both eligible inference paths failed or produced invalid output."""


class _ProviderRequestRejected(Exception):
    """A provider rejected the request shape; retrying elsewhere is unsafe."""


class _InvalidOutput(Exception):
    """The provider output failed decoding or task-schema validation."""


@dataclass(frozen=True)
class AIModelResult:
    job_id: str
    meeting_id: str
    task_type: str
    provider: str
    model_name: str
    fallback_used: bool
    fallback_reason: Optional[str]
    result: Any


class AIModelRouter:
    """Try local inference first, with explicitly authorized API fallback.

    Provider callable contract: ``provider(context_payload, timeout_seconds)``.
    ``schema_validator`` must validate and raise on invalid data (or return
    False). Circuit state is process-local because the project has no shared
    circuit-breaker state contract for NLP workers.
    """

    def __init__(
        self,
        local_provider: Callable[[Any, float], Any],
        schema_validator: Callable[[Any, str], Any],
        *,
        gemini_provider: Optional[Callable[[Any, float], Any]] = None,
        fallback_allowed: bool = False,
        local_model_name: str = "local",
        gemini_model_name: Optional[str] = None,
        local_timeout_seconds: float = 60.0,
        gemini_timeout_seconds: float = 30.0,
        inference_retries: int = 0,
        retry_backoff_seconds: float = 0.0,
        circuit_failure_threshold: int = 3,
        circuit_reset_seconds: float = 30.0,
        callback_client: Any = None,
        backend_base_url: Optional[str] = None,
        internal_token: Optional[str] = None,
    ):
        if not callable(local_provider) or not callable(schema_validator):
            raise ValueError("local provider and schema validator are required")
        if inference_retries < 0 or circuit_failure_threshold < 1:
            raise ValueError("invalid retry or circuit-breaker configuration")
        if local_timeout_seconds <= 0 or gemini_timeout_seconds <= 0:
            raise ValueError("provider timeouts must be positive")
        self.local_provider = local_provider
        self.gemini_provider = gemini_provider
        self.schema_validator = schema_validator
        self.fallback_allowed = fallback_allowed
        self.local_model_name = local_model_name
        self.gemini_model_name = gemini_model_name
        self.local_timeout_seconds = local_timeout_seconds
        self.gemini_timeout_seconds = gemini_timeout_seconds
        self.inference_retries = inference_retries
        self.retry_backoff_seconds = max(0.0, retry_backoff_seconds)
        self.circuit_failure_threshold = circuit_failure_threshold
        self.circuit_reset_seconds = max(0.0, circuit_reset_seconds)
        self.callback_client = callback_client
        self.backend_base_url = backend_base_url
        self.internal_token = internal_token
        self._local_failures = 0
        self._circuit_opened_at: Optional[float] = None
        self._circuit_probe_in_progress = False
        self._circuit_lock = Lock()

    def generate(
        self,
        *,
        job_id: str,
        meeting_id: str,
        context_payload: Any,
        task_type: str,
    ) -> AIModelResult:
        if not job_id or not meeting_id or not task_type or context_payload is None:
            raise ValueError("job_id, meeting_id, task_type and context_payload are required")

        fallback_reason = None
        if self._local_circuit_available():
            try:
                raw, parsed = self._infer_and_validate(
                    self.local_provider, context_payload, task_type,
                    self.local_timeout_seconds, "LOCAL", self.local_model_name, False,
                    job_id, meeting_id,
                )
                self._record_local_success()
                return AIModelResult(job_id, meeting_id, task_type, "LOCAL",
                                     self.local_model_name, False, None, parsed)
            except _ProviderRequestRejected as exc:
                raise AIModelRoutingError("Local provider rejected the inference request") from None
            except Exception as exc:
                if not self._fallback_eligible(exc):
                    logger.warning("Local NLP request failed with non-fallback error (code=%s)",
                                   self._safe_error_code(exc))
                    raise AIModelRoutingError("Local inference failed with a non-fallback error") from None
                fallback_reason = self._safe_error_code(exc)
                self._record_local_failure()
                logger.warning("Local NLP inference failed (code=%s)", fallback_reason)
        else:
            fallback_reason = "LOCAL_CIRCUIT_OPEN"

        if not self.fallback_allowed or self.gemini_provider is None or not self.gemini_model_name:
            raise AIModelRoutingError(
                f"Local inference failed ({fallback_reason}); authorized Gemini fallback is unavailable"
            )

        try:
            _, parsed = self._infer_and_validate(
                self.gemini_provider, context_payload, task_type,
                self.gemini_timeout_seconds, "GEMINI", self.gemini_model_name, True,
                job_id, meeting_id,
            )
            return AIModelResult(job_id, meeting_id, task_type, "GEMINI",
                                 self.gemini_model_name, True, fallback_reason, parsed)
        except Exception as exc:
            code = self._safe_error_code(exc)
            logger.warning("Gemini fallback failed (code=%s)", code)
            raise AIModelRoutingError(f"Local and Gemini inference failed ({code})") from None

    def _infer_and_validate(self, provider_fn, context, task_type, timeout, provider,
                            model_name, fallback_used, job_id, meeting_id):
        last_error = None
        for attempt in range(self.inference_retries + 1):
            request_id = str(uuid4())  # a fresh id for each actual inference
            started = time.monotonic()
            raw = None
            status = "failed"
            error_code = None
            try:
                try:
                    raw = provider_fn(context, timeout)
                except (TypeError, ValueError):
                    raise _ProviderRequestRejected() from None
                document = self._decode_result(raw)
                try:
                    validated = self.schema_validator(document, task_type)
                except Exception:
                    raise _InvalidOutput() from None
                if validated is False:
                    raise _InvalidOutput()
                if validated is not None and validated is not True:
                    document = validated
                status = "success"
                return raw, document
            except Exception as exc:
                last_error = exc
                error_code = self._safe_error_code(exc)
            finally:
                latency_ms = max(0, int((time.monotonic() - started) * 1000))
                self._send_usage(request_id, raw, provider, model_name, task_type,
                                 latency_ms, status, fallback_used, error_code,
                                 job_id, meeting_id)
            if last_error is None:
                raise AIModelRoutingError("inference ended without a result")
            if attempt >= self.inference_retries or not self._retryable(last_error):
                raise last_error
            if self.retry_backoff_seconds:
                time.sleep(self.retry_backoff_seconds * (2 ** attempt))
        raise last_error or AIModelRoutingError("inference failed")

    @staticmethod
    def _decode_result(raw):
        value = raw
        if isinstance(raw, Mapping):
            has_usage = any(key in raw for key in ("usage", "usageMetadata", "usage_metadata"))
            for key in ("result", "output", "text", "content"):
                # Preserve ordinary JSON documents with fields named result/text;
                # unwrap only provider envelopes carrying usage or a lone text.
                if key in raw and (has_usage or (key == "text" and len(raw) == 1)):
                    value = raw[key]
                    break
        if isinstance(value, str):
            value = json.loads(value)
        if value is None or value == "":
            raise ValueError("OUTPUT_EMPTY")
        return value

    def _send_usage(self, request_id, raw, provider, model_name, task_type,
                    latency_ms, status, fallback_used, error_code, job_id, meeting_id):
        if not (self.callback_client and self.backend_base_url):
            return
        usage = TokenCounter.read(raw)
        payload = {
            "requestId": request_id,
            "jobId": job_id,
            "meetingId": meeting_id,
            "modelName": model_name,
            "provider": provider,
            "taskType": task_type,
            "inputTokens": usage.input_tokens,
            "outputTokens": usage.output_tokens,
            "totalTokens": usage.total_tokens,
            "tokenSource": usage.source,
            "processingTimeMs": latency_ms,
            "status": status,
            "fallbackUsed": fallback_used,
            "errorCode": error_code,
        }
        try:
            self.callback_client.send_ai_usage(
                self.backend_base_url, payload, self.internal_token
            )
        except Exception:
            logger.warning("AI usage callback failed (request_id=%s)", request_id)

    @staticmethod
    def _safe_error_code(exc):
        if isinstance(exc, _ProviderRequestRejected):
            return "PROVIDER_REQUEST_REJECTED"
        if isinstance(exc, _InvalidOutput):
            return "OUTPUT_SCHEMA_INVALID"
        if isinstance(exc, TimeoutError):
            return "PROVIDER_TIMEOUT"
        if isinstance(exc, ConnectionError):
            return "PROVIDER_CONNECTION_ERROR"
        if isinstance(exc, json.JSONDecodeError):
            return "OUTPUT_INVALID_JSON"
        if isinstance(exc, ValueError):
            if str(exc) in {"OUTPUT_EMPTY", "OUTPUT_SCHEMA_INVALID"}:
                return str(exc)
            return "OUTPUT_INVALID"
        return "PROVIDER_INFERENCE_ERROR"

    @staticmethod
    def _retryable(exc):
        return isinstance(exc, (_InvalidOutput, TimeoutError, ConnectionError, RuntimeError, json.JSONDecodeError)) \
            or (isinstance(exc, ValueError) and str(exc) in {"OUTPUT_EMPTY", "OUTPUT_SCHEMA_INVALID"})

    @classmethod
    def _fallback_eligible(cls, exc):
        return cls._retryable(exc)

    def _local_circuit_available(self):
        with self._circuit_lock:
            if self._circuit_opened_at is None:
                return True
            if self._circuit_probe_in_progress:
                return False
            if time.monotonic() - self._circuit_opened_at >= self.circuit_reset_seconds:
                self._circuit_probe_in_progress = True
                return True
            return False

    def _record_local_failure(self):
        with self._circuit_lock:
            self._local_failures += 1
            if self._local_failures >= self.circuit_failure_threshold:
                self._circuit_opened_at = time.monotonic()
            self._circuit_probe_in_progress = False

    def _record_local_success(self):
        with self._circuit_lock:
            self._local_failures = 0
            self._circuit_opened_at = None
            self._circuit_probe_in_progress = False
