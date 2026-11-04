"""Configured Ollama-compatible local inference client; no provider routing."""

import logging
import re
import time
from urllib.parse import urlsplit

import requests

from app.core.config import settings
from app.schemas.meeting_summary import MeetingSummary


logger = logging.getLogger("smartrec.local_llm")


class LocalLLMError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class LocalLLMClient:
    def __init__(self, endpoint: str | None = None, model: str | None = None,
                 timeout_seconds: float | None = None,
                 connect_timeout_seconds: float | None = None):
        self.endpoint = settings.local_llm_endpoint if endpoint is None else endpoint
        self.model = settings.local_llm_model if model is None else model
        self.timeout_seconds = (
            settings.local_llm_timeout_seconds if timeout_seconds is None else timeout_seconds
        )
        self.connect_timeout_seconds = (
            settings.local_llm_connect_timeout_seconds
            if connect_timeout_seconds is None else connect_timeout_seconds
        )

    def generate(self, prompt: str, system_prompt: str, temperature: float,
                 max_tokens: int) -> dict:
        endpoint = self._validated_endpoint()
        model = self._validated_model()
        started = time.monotonic()
        payload = {
            "model": model,
            "prompt": prompt,
            "system": system_prompt,
            "stream": False,
            "format": MeetingSummary.model_json_schema(),
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        try:
            response = requests.post(
                endpoint,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=(self.connect_timeout_seconds, self.timeout_seconds),
            )
            response.raise_for_status()
            body = response.json()
        except requests.exceptions.JSONDecodeError as exc:
            raise LocalLLMError("LOCAL_MODEL_INVALID_RESPONSE") from exc
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code == 429 or (status_code is not None and status_code >= 500):
                logger.warning("Local inference service returned HTTP %s", status_code)
                raise LocalLLMError("LOCAL_MODEL_UNAVAILABLE") from exc
            logger.warning("Local inference request was rejected with HTTP %s", status_code)
            raise LocalLLMError("LOCAL_MODEL_REQUEST_REJECTED") from exc
        except requests.Timeout as exc:
            logger.warning("Local inference timed out")
            raise LocalLLMError("LOCAL_MODEL_TIMEOUT") from exc
        except requests.RequestException as exc:
            logger.warning("Local inference transport failed: %s", type(exc).__name__)
            raise LocalLLMError("LOCAL_MODEL_UNAVAILABLE") from exc
        except ValueError as exc:
            raise LocalLLMError("LOCAL_MODEL_INVALID_RESPONSE") from exc

        if not isinstance(body, dict) or body.get("error"):
            raise LocalLLMError("LOCAL_MODEL_UNAVAILABLE")
        text = body.get("response")
        if not isinstance(text, str) or not text.strip():
            raise LocalLLMError("LOCAL_MODEL_INVALID_RESPONSE")

        prompt_tokens = self._token_count(body.get("prompt_eval_count"))
        output_tokens = self._token_count(body.get("eval_count"))
        return {
            "text": text,
            "model_identifier": model,
            "input_tokens": prompt_tokens,
            "output_tokens": output_tokens,
            "total_tokens": (
                prompt_tokens + output_tokens
                if prompt_tokens is not None and output_tokens is not None
                else None
            ),
            "token_source": (
                "ollama_metadata"
                if prompt_tokens is not None or output_tokens is not None
                else "unavailable"
            ),
            "done_reason": (
                body.get("done_reason")
                if isinstance(body.get("done_reason"), str)
                else None
            ),
            "processing_time_ms": max(0, int((time.monotonic() - started) * 1000)),
        }

    def _validated_endpoint(self) -> str:
        if not self.endpoint:
            raise LocalLLMError("LOCAL_MODEL_NOT_CONFIGURED")
        parsed = urlsplit(self.endpoint)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path != "/api/generate"
        ):
            raise LocalLLMError("LOCAL_MODEL_ENDPOINT_INVALID")
        if self.connect_timeout_seconds <= 0 or self.timeout_seconds <= 0:
            raise LocalLLMError("LOCAL_MODEL_CONFIGURATION_INVALID")
        return self.endpoint

    def _validated_model(self) -> str:
        model = self.model
        if (
            not isinstance(model, str)
            or not re.search(r"qwen2\.5", model, re.IGNORECASE)
            or not re.search(r"3b", model, re.IGNORECASE)
            or re.search(r"7b", model, re.IGNORECASE)
        ):
            raise LocalLLMError("LOCAL_MODEL_CONFIGURATION_INVALID")
        return model

    @staticmethod
    def _token_count(value) -> int | None:
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
        return None
