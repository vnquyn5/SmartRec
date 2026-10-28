import fnmatch
from unittest.mock import MagicMock, patch

import pytest
import requests

from app.core.config import settings
from app.schemas.llm_schemas import LLMRequest
from app.services.llm_clients import (
    GeminiAPIError,
    GeminiClient,
    GeminiRateLimiter,
    LocalLLMClient,
    LocalLLMConnectionError,
    LocalLLMTimeoutError,
)
from app.services.llm_guard import (
    CostLimitExceededError,
    LLMGuard,
    QuotaExceededError,
    build_llm_guard,
)
from app.services.llm_orchestrator import LLMOrchestrator

FAKE_KEY = "AIzaSyDUMMYKEYFORTESTING0123456789abcde"


# --------------------------------------------------------------------------- helpers
def make_response(status=200, json_data=None, text=""):
    resp = MagicMock()
    resp.status_code = status
    resp.text = text
    resp.json.return_value = json_data or {}
    return resp


GEMINI_OK = make_response(
    200,
    {
        "candidates": [{"content": {"parts": [{"text": "Tóm tắt từ Gemini"}]}}],
        "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 50, "totalTokenCount": 150},
    },
)

LOCAL_OK = make_response(200, {"response": "Tóm tắt từ Local", "prompt_eval_count": 10, "eval_count": 5})


def new_gemini(max_retries=3, rpm=100, sleeps=None):
    sleeps = sleeps if sleeps is not None else []
    return GeminiClient(
        api_key=FAKE_KEY,
        rate_limiter=GeminiRateLimiter(rpm),
        max_retries=max_retries,
        sleep=sleeps.append,
        jitter=lambda lo, hi: hi,  # xác định: luôn lấy cận trên
    )


class FakeRedis:
    """Triển khai tối thiểu các lệnh Redis mà LLMGuard sử dụng."""

    def __init__(self):
        self.data = {}
        self.fail = False

    def _chk(self):
        if self.fail:
            raise ConnectionError("redis down")

    def incr(self, k):
        self._chk()
        self.data[k] = int(self.data.get(k, 0)) + 1
        return self.data[k]

    def decr(self, k):
        self._chk()
        self.data[k] = int(self.data.get(k, 0)) - 1
        return self.data[k]

    def incrbyfloat(self, k, v):
        self._chk()
        self.data[k] = float(self.data.get(k, 0.0)) + v
        return self.data[k]

    def expire(self, k, ttl):
        self._chk()
        return True

    def get(self, k):
        self._chk()
        return self.data.get(k)

    def set(self, k, v, ex=None):
        self._chk()
        self.data[k] = v
        return True

    def exists(self, k):
        self._chk()
        return 1 if k in self.data else 0

    def delete(self, *keys):
        self._chk()
        for k in keys:
            self.data.pop(k, None)

    def scan_iter(self, match=None):
        self._chk()
        return [k for k in list(self.data) if fnmatch.fnmatch(k, match)]


# --------------------------------------------------------------------------- Gemini security
def test_gemini_api_key_sent_in_header_not_in_url():
    with patch("app.services.llm_clients.requests.post", return_value=GEMINI_OK) as post:
        new_gemini().generate("hello")

    url = post.call_args.args[0]
    assert "key=" not in url
    assert FAKE_KEY not in url
    assert post.call_args.kwargs["headers"]["x-goog-api-key"] == FAKE_KEY


def test_network_loss_error_does_not_leak_api_key():
    leaky = requests.exceptions.ConnectionError(
        f"HTTPSConnectionPool(host='generativelanguage.googleapis.com', port=443): Max retries exceeded "
        f"with url: /v1beta/models/x:generateContent?key={FAKE_KEY} (Caused by NameResolutionError)"
    )
    with patch("app.services.llm_clients.requests.post", side_effect=leaky):
        with pytest.raises(GeminiAPIError) as exc:
            new_gemini().generate("hello")

    assert FAKE_KEY not in str(exc.value)
    assert "[SECRET_REDACTED]" in str(exc.value)
    assert exc.value.__cause__ is None  # không giữ lại exception gốc chứa key


def test_http_error_body_is_scrubbed():
    body = make_response(403, text=f"API key {FAKE_KEY} not valid")
    with patch("app.services.llm_clients.requests.post", return_value=body):
        with pytest.raises(GeminiAPIError) as exc:
            new_gemini().generate("hello")
    assert FAKE_KEY not in str(exc.value)


def test_gemini_timeout_raises_gemini_error():
    with patch("app.services.llm_clients.requests.post", side_effect=requests.exceptions.Timeout("t")):
        with pytest.raises(GeminiAPIError) as exc:
            new_gemini().generate("hello")
    assert "timeout" in str(exc.value).lower()


# --------------------------------------------------------------------------- Gemini retry / throttle
def test_gemini_429_retries_with_exponential_backoff_then_succeeds():
    sleeps = []
    responses = [make_response(429), make_response(429), GEMINI_OK]
    with patch("app.services.llm_clients.requests.post", side_effect=responses) as post:
        result = new_gemini(sleeps=sleeps).generate("hello")

    assert result["text"] == "Tóm tắt từ Gemini"
    assert post.call_count == 3
    # jitter trả cận trên => 1s * 2^0, 1s * 2^1
    assert sleeps == [1.0, 2.0]


def test_gemini_429_exhausted_retries_raises():
    sleeps = []
    with patch("app.services.llm_clients.requests.post", return_value=make_response(429)) as post:
        with pytest.raises(GeminiAPIError) as exc:
            new_gemini(max_retries=3, sleeps=sleeps).generate("hello")

    assert "429" in str(exc.value)
    assert post.call_count == 4  # 1 lần đầu + 3 lần retry
    assert len(sleeps) == 3


def test_rate_limiter_blocks_over_rpm_then_recovers():
    now = [0.0]
    limiter = GeminiRateLimiter(12, clock=lambda: now[0], sleep=lambda s: None)

    assert all(limiter.acquire(0.0) for _ in range(12))
    assert limiter.acquire(1.0) is False  # slot thứ 13 phải chờ ~60s > 1s cho phép

    now[0] = 61.0
    assert limiter.acquire(0.0) is True


def test_gemini_client_rejects_when_rpm_exceeded_without_calling_api():
    limiter = GeminiRateLimiter(1, clock=lambda: 0.0, sleep=lambda s: None)
    client = GeminiClient(api_key=FAKE_KEY, rate_limiter=limiter, max_retries=0)
    with patch("app.services.llm_clients.requests.post", return_value=GEMINI_OK) as post:
        client.generate("one")
        with pytest.raises(GeminiAPIError) as exc:
            client.generate("two")

    assert "request/phút" in str(exc.value)
    assert post.call_count == 1


# --------------------------------------------------------------------------- Local client (requests thật, chỉ mock mạng)
def test_local_client_timeout_and_connection_errors_mapped():
    client = LocalLLMClient(endpoint="http://localhost:11434/api/generate", model="qwen", timeout_seconds=1)
    with patch("app.services.llm_clients.requests.post", side_effect=requests.exceptions.Timeout()):
        with pytest.raises(LocalLLMTimeoutError):
            client.generate("hi")
    with patch("app.services.llm_clients.requests.post", side_effect=requests.exceptions.ConnectionError("refused")):
        with pytest.raises(LocalLLMConnectionError):
            client.generate("hi")
    with patch("app.services.llm_clients.requests.post", return_value=make_response(500, text="boom")):
        with pytest.raises(LocalLLMConnectionError):
            client.generate("hi")


def build_orchestrator(guard=None, fallback_enabled=True, gemini=None):
    local = LocalLLMClient(endpoint="http://localhost:11434/api/generate", model="qwen", timeout_seconds=1)
    return LLMOrchestrator(
        local_client=local,
        gemini_client=gemini or new_gemini(),
        llm_guard=guard or LLMGuard(max_requests_per_job=5, max_cost_per_job=1.0),
        callback_client=MagicMock(),
        fallback_enabled=fallback_enabled,
    )


def test_e2e_local_down_falls_back_to_gemini_via_http_layer():
    def fake_post(url, **kwargs):
        if "11434" in url:
            raise requests.exceptions.ConnectionError("refused")
        return GEMINI_OK

    with patch("app.services.llm_clients.requests.post", side_effect=fake_post):
        res = build_orchestrator().generate(LLMRequest(job_id="e2e-1", prompt="Họp sprint"))

    assert res.fallback_used is True
    assert res.fallback_reason == "LOCAL_CONNECTION_ERROR"
    assert res.estimated_cost_usd > 0


def test_e2e_total_network_loss_no_key_leak_and_no_pii_in_error():
    def fake_post(url, **kwargs):
        if "11434" in url:
            raise requests.exceptions.Timeout()
        raise requests.exceptions.ConnectionError(f"failed ...?key={FAKE_KEY}")

    with patch("app.services.llm_clients.requests.post", side_effect=fake_post):
        with pytest.raises(GeminiAPIError) as exc:
            build_orchestrator().generate(
                LLMRequest(job_id="e2e-2", prompt="SĐT 0912345678 email a@b.com")
            )

    assert FAKE_KEY not in str(exc.value)
    assert "0912345678" not in str(exc.value)


def test_e2e_fallback_disabled_never_touches_gemini():
    calls = []

    def fake_post(url, **kwargs):
        calls.append(url)
        raise requests.exceptions.Timeout()

    from app.services.llm_clients import FallbackDisabledError

    with patch("app.services.llm_clients.requests.post", side_effect=fake_post):
        with pytest.raises(FallbackDisabledError):
            build_orchestrator(fallback_enabled=False).generate(LLMRequest(job_id="e2e-3", prompt="x"))

    assert all("googleapis" not in c for c in calls)


# --------------------------------------------------------------------------- PII policy enforcement
def _sent_prompt_after_fallback(request):
    captured = {}

    def fake_post(url, **kwargs):
        if "11434" in url:
            raise requests.exceptions.ConnectionError("refused")
        captured["payload"] = kwargs["json"]
        return GEMINI_OK

    with patch("app.services.llm_clients.requests.post", side_effect=fake_post):
        build_orchestrator().generate(request)
    return captured["payload"]["contents"][-1]["parts"][0]["text"]


def test_pii_redaction_cannot_be_disabled_by_client_when_enforced(monkeypatch):
    monkeypatch.setattr(settings, "pii_redaction_enforced", True)
    sent = _sent_prompt_after_fallback(
        LLMRequest(job_id="pii-1", prompt="SĐT 0912345678", apply_pii_redaction=False)
    )
    assert "0912345678" not in sent
    assert "[PHONE_REDACTED]" in sent


def test_pii_redaction_respects_request_flag_when_policy_not_enforced(monkeypatch):
    monkeypatch.setattr(settings, "pii_redaction_enforced", False)
    sent = _sent_prompt_after_fallback(
        LLMRequest(job_id="pii-2", prompt="SĐT 0912345678", apply_pii_redaction=False)
    )
    assert "0912345678" in sent


# --------------------------------------------------------------------------- Redis-backed guard
def test_guard_quota_shared_across_workers_via_redis():
    shared = FakeRedis()
    worker_a = LLMGuard(max_requests_per_job=2, redis_client=shared)
    worker_b = LLMGuard(max_requests_per_job=2, redis_client=shared)

    worker_a.check_and_increment_request("job-r")
    worker_b.check_and_increment_request("job-r")
    with pytest.raises(QuotaExceededError):
        worker_a.check_and_increment_request("job-r")
    assert worker_b.get_job_stats("job-r")["requests"] == 2


def test_guard_cost_ceiling_shared_via_redis():
    shared = FakeRedis()
    a = LLMGuard(max_cost_per_job=0.01, redis_client=shared)
    b = LLMGuard(max_cost_per_job=0.01, redis_client=shared)

    a.record_and_check_cost("job-c", 0.006)
    with pytest.raises(CostLimitExceededError):
        b.record_and_check_cost("job-c", 0.006)
    with pytest.raises(CostLimitExceededError):
        a.check_cost_ceiling("job-c")


def test_guard_callback_idempotency_survives_new_instance_via_redis():
    shared = FakeRedis()
    LLMGuard(redis_client=shared).mark_callback_processed("job-cb", "exec-1")

    restarted = LLMGuard(redis_client=shared)  # mô phỏng worker restart
    assert restarted.is_callback_processed("job-cb", "exec-1") is True
    assert restarted.is_callback_processed("job-cb", "exec-2") is False


def test_guard_reset_job_clears_redis_state():
    shared = FakeRedis()
    g = LLMGuard(max_requests_per_job=5, redis_client=shared)
    g.check_and_increment_request("job-x")
    g.record_and_check_cost("job-x", 0.001)
    g.mark_callback_processed("job-x", "e1")
    g.reset_job("job-x")
    assert g.get_job_stats("job-x") == {"requests": 0, "accumulated_cost": 0.0}
    assert g.is_callback_processed("job-x", "e1") is False


def test_guard_degrades_to_memory_when_redis_fails_and_still_enforces_quota():
    broken = FakeRedis()
    broken.fail = True
    g = LLMGuard(max_requests_per_job=1, redis_client=broken)
    g.check_and_increment_request("job-d")
    with pytest.raises(QuotaExceededError):
        g.check_and_increment_request("job-d")


def test_build_llm_guard_memory_backend(monkeypatch):
    monkeypatch.setattr(settings, "llm_guard_backend", "memory")
    assert build_llm_guard().backend == "memory"


def test_build_llm_guard_auto_falls_back_to_memory_without_redis(monkeypatch):
    monkeypatch.setattr(settings, "llm_guard_backend", "auto")
    monkeypatch.setattr(settings, "redis_host", "127.0.0.1")
    monkeypatch.setattr(settings, "redis_port", 1)  # cổng chắc chắn không có dịch vụ
    assert build_llm_guard().backend == "memory"
