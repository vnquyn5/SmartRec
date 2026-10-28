import random
import re
import threading
import time
import logging
from collections import deque
import requests
from typing import Callable, Deque, Dict, Any, Optional

from app.core.config import settings

logger = logging.getLogger("smartrec.llm_clients")


class LLMClientError(Exception):
    """Lỗi cơ sở cho các client tương tác LLM."""
    pass


class LocalLLMTimeoutError(LLMClientError):
    """Local LLM không phản hồi trong khoảng thời gian quy định."""
    pass


class LocalLLMConnectionError(LLMClientError):
    """Không thể kết nối hoặc nhận phản hồi lỗi từ Local LLM."""
    pass


class GeminiAPIError(LLMClientError):
    """Lỗi khi gọi Google Gemini API."""
    pass


class FallbackDisabledError(LLMClientError):
    """Cơ chế Fallback bị vô hiệu hóa bởi cấu hình khi Local LLM gặp sự cố."""
    pass


class LocalLLMClient:
    """Client kết nối tới Local LLM (Ollama / vLLM / Local Worker)."""

    def __init__(
        self,
        endpoint: Optional[str] = None,
        model: Optional[str] = None,
        timeout_seconds: Optional[float] = None
    ):
        self.endpoint = endpoint or settings.local_llm_endpoint
        self.model = model or settings.local_llm_model
        self.timeout_seconds = timeout_seconds or settings.local_llm_timeout_seconds

    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> Dict[str, Any]:
        """Gửi prompt tới Local LLM với timeout kiểm soát nghiêm ngặt."""
        start_time = time.time()
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens
            }
        }
        if system_prompt:
            payload["system"] = system_prompt

        try:
            response = requests.post(
                self.endpoint,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=self.timeout_seconds
            )
            elapsed_ms = int((time.time() - start_time) * 1000)

            if response.status_code >= 400:
                raise LocalLLMConnectionError(
                    f"Local LLM phản hồi mã lỗi HTTP {response.status_code}: {response.text[:200]}"
                )

            data = response.json()
            # Xử lý format trả về chuẩn của Ollama hoặc tương đương
            output_text = data.get("response") or data.get("text") or ""
            input_tokens = data.get("prompt_eval_count") or max(1, len(prompt.split()))
            output_tokens = data.get("eval_count") or max(1, len(output_text.split()))

            return {
                "text": output_text,
                "model_name": self.model,
                "model_version": "local-v1",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "processing_time_ms": elapsed_ms,
                "estimated_cost_usd": 0.0  # Chạy Local không tốn chi phí API ngoài
            }

        except requests.exceptions.Timeout as e:
            elapsed_ms = int((time.time() - start_time) * 1000)
            logger.warning(
                f"Local LLM timeout sau {elapsed_ms}ms (ngưỡng {self.timeout_seconds}s)"
            )
            raise LocalLLMTimeoutError(
                f"Local LLM timeout sau {self.timeout_seconds} giây"
            ) from e

        except requests.exceptions.RequestException as e:
            elapsed_ms = int((time.time() - start_time) * 1000)
            logger.warning(f"Local LLM gặp lỗi kết nối sau {elapsed_ms}ms: {e}")
            raise LocalLLMConnectionError(
                f"Không thể kết nối tới Local LLM tại {self.endpoint}: {e}"
            ) from e


class GeminiRateLimiter:
    """Sliding-window limiter (RPM) bảo vệ khỏi HTTP 429 từ Google. An toàn đa luồng."""

    def __init__(
        self,
        max_requests_per_minute: int,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.max_rpm = max(1, int(max_requests_per_minute))
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._timestamps: Deque[float] = deque()

    def acquire(self, max_wait_seconds: float) -> bool:
        """Chiếm 1 slot. Trả False nếu phải chờ lâu hơn `max_wait_seconds`."""
        deadline = self._clock() + max_wait_seconds
        while True:
            with self._lock:
                now = self._clock()
                while self._timestamps and now - self._timestamps[0] >= 60.0:
                    self._timestamps.popleft()
                if len(self._timestamps) < self.max_rpm:
                    self._timestamps.append(now)
                    return True
                wait = 60.0 - (now - self._timestamps[0])
            if self._clock() + wait > deadline:
                return False
            self._sleep(max(wait, 0.0))


# Bộ giới hạn dùng chung cho mọi GeminiClient trong tiến trình
_shared_gemini_limiter: Optional[GeminiRateLimiter] = None
_shared_limiter_lock = threading.Lock()


def get_shared_gemini_limiter() -> GeminiRateLimiter:
    global _shared_gemini_limiter
    with _shared_limiter_lock:
        if _shared_gemini_limiter is None:
            _shared_gemini_limiter = GeminiRateLimiter(settings.gemini_rpm_limit)
        return _shared_gemini_limiter


_KEY_IN_TEXT = re.compile(r"([?&]key=)[^&\s'\"]+", re.IGNORECASE)
_AIZA_IN_TEXT = re.compile(r"AIza[0-9A-Za-z\-_]{20,}")


class GeminiClient:
    """Client tương tác với Google Gemini API (dự phòng fallback)."""

    RETRYABLE_STATUS = (429, 503)

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        rate_limiter: Optional[GeminiRateLimiter] = None,
        max_retries: Optional[int] = None,
        sleep: Callable[[float], None] = time.sleep,
        jitter: Callable[[float, float], float] = random.uniform,
    ):
        self.api_key = api_key or settings.gemini_api_key
        self.model = model or settings.gemini_model
        self.timeout_seconds = timeout_seconds or settings.gemini_timeout_seconds
        self.rate_limiter = rate_limiter or get_shared_gemini_limiter()
        self.max_retries = settings.gemini_max_retries if max_retries is None else max_retries
        self._sleep = sleep
        self._jitter = jitter

    def _scrub(self, text: object) -> str:
        """Loại bỏ API key khỏi mọi thông điệp lỗi trước khi ném ra ngoài/ghi log."""
        s = str(text)
        if self.api_key:
            s = s.replace(self.api_key, "[SECRET_REDACTED]")
        s = _KEY_IN_TEXT.sub(r"\1[SECRET_REDACTED]", s)
        return _AIZA_IN_TEXT.sub("[SECRET_REDACTED]", s)

    def _backoff(self, attempt: int) -> float:
        cap = min(
            settings.gemini_retry_max_backoff_seconds,
            settings.gemini_retry_base_backoff_seconds * (2 ** attempt),
        )
        return self._jitter(0.0, cap)

    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> Dict[str, Any]:
        """Gửi prompt tới Google Gemini API qua REST (key nằm trong header, không nằm trong URL)."""
        if not self.api_key:
            raise GeminiAPIError("GEMINI_API_KEY chưa được cấu hình cho fallback")

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent"
        )
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }

        contents = []
        if system_prompt:
            contents.append({
                "role": "user",
                "parts": [{"text": f"System Instruction: {system_prompt}"}]
            })
        contents.append({
            "role": "user",
            "parts": [{"text": prompt}]
        })

        payload = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens
            }
        }

        start_time = time.time()
        attempt = 0
        while True:
            if not self.rate_limiter.acquire(settings.gemini_rate_limit_max_wait_seconds):
                raise GeminiAPIError(
                    f"Vượt giới hạn {self.rate_limiter.max_rpm} request/phút tới Gemini (throttle nội bộ)"
                )

            try:
                response = requests.post(
                    url,
                    json=payload,
                    headers=headers,
                    timeout=self.timeout_seconds
                )
            except requests.exceptions.Timeout as e:
                elapsed_ms = int((time.time() - start_time) * 1000)
                logger.warning(f"Gemini API timeout sau {elapsed_ms}ms")
                raise GeminiAPIError(f"Gemini API timeout sau {self.timeout_seconds} giây") from None
            except requests.exceptions.RequestException as e:
                elapsed_ms = int((time.time() - start_time) * 1000)
                logger.warning(
                    f"Lỗi mạng khi kết nối Gemini API sau {elapsed_ms}ms: {type(e).__name__}"
                )
                raise GeminiAPIError(
                    f"Lỗi mạng kết nối tới Gemini API ({type(e).__name__}): {self._scrub(e)}"
                ) from None

            if response.status_code in self.RETRYABLE_STATUS and attempt < self.max_retries:
                delay = self._backoff(attempt)
                logger.warning(
                    f"Gemini trả HTTP {response.status_code}; thử lại lần {attempt + 1}/{self.max_retries} "
                    f"sau {delay:.2f}s"
                )
                self._sleep(delay)
                attempt += 1
                continue
            break

        elapsed_ms = int((time.time() - start_time) * 1000)

        if response.status_code == 429:
            raise GeminiAPIError("Google Gemini API bị chạm trần Quota / Rate limit (HTTP 429)")

        if response.status_code >= 400:
            raise GeminiAPIError(
                f"Gemini API phản hồi mã lỗi HTTP {response.status_code}: "
                f"{self._scrub(response.text[:200])}"
            )

        data = response.json()
        candidates = data.get("candidates", [])
        output_text = ""
        if candidates and "content" in candidates[0]:
            parts = candidates[0]["content"].get("parts", [])
            output_text = "".join(part.get("text", "") for part in parts)

        # Metadata token từ Gemini
        usage_metadata = data.get("usageMetadata", {})
        input_tokens = usage_metadata.get("promptTokenCount") or max(1, len(prompt.split()))
        output_tokens = usage_metadata.get("candidatesTokenCount") or max(1, len(output_text.split()))
        total_tokens = usage_metadata.get("totalTokenCount") or (input_tokens + output_tokens)

        # Tính toán chi phí ước tính dựa trên cấu hình giá
        cost_usd = (
            (input_tokens / 1000.0) * settings.gemini_cost_per_1k_input_tokens +
            (output_tokens / 1000.0) * settings.gemini_cost_per_1k_output_tokens
        )

        return {
            "text": output_text,
            "model_name": self.model,
            "model_version": "gemini-1.5",
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "processing_time_ms": elapsed_ms,
            "estimated_cost_usd": round(cost_usd, 6)
        }
