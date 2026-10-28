from unittest.mock import patch
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.api.nlp_routes import nlp_router, nlp_pipeline_orchestrator
from app.core.config import settings
from app.schemas.llm_schemas import LLMResponse
from app.services.llm_guard import QuotaExceededError, CostLimitExceededError
from app.services.llm_clients import FallbackDisabledError, GeminiAPIError

TEST_TOKEN = "unit-test-internal-token"
settings.smartrec_internal_token = TEST_TOKEN

app = FastAPI()
app.include_router(nlp_router, prefix="/api/v1")
client = TestClient(app, headers={"X-Internal-Token": TEST_TOKEN})
anonymous_client = TestClient(app)


def test_api_generate_success():
    mock_response = LLMResponse(
        job_id="job-api-1",
        text="Tóm tắt thành công qua API",
        model_name="qwen2.5:7b",
        model_version="2.5.0",
        fallback_used=False,
        input_tokens=120,
        output_tokens=60,
        total_tokens=180,
        processing_time_ms=350,
        estimated_cost_usd=0.0
    )

    with patch("app.api.nlp_routes.llm_orchestrator.generate", return_value=mock_response):
        payload = {
            "job_id": "job-api-1",
            "prompt": "Xin hãy tóm tắt nội dung cuộc họp",
            "temperature": 0.5,
            "max_tokens": 1024,
            "apply_pii_redaction": True
        }
        res = client.post("/api/v1/nlp/generate", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["job_id"] == "job-api-1"
        assert data["text"] == "Tóm tắt thành công qua API"
        assert data["fallback_used"] is False
        assert data["estimated_cost_usd"] == 0.0


def test_api_generate_fallback_disabled_returns_503():
    with patch(
        "app.api.nlp_routes.llm_orchestrator.generate",
        side_effect=FallbackDisabledError("Fallback bị tắt")
    ):
        payload = {
            "job_id": "job-api-disabled",
            "prompt": "Test fallback disabled"
        }
        res = client.post("/api/v1/nlp/generate", json=payload)
        assert res.status_code == 503
        data = res.json()
        assert data["detail"]["code"] == "FALLBACK_DISABLED"


def test_api_generate_quota_exceeded_returns_429():
    with patch(
        "app.api.nlp_routes.llm_orchestrator.generate",
        side_effect=QuotaExceededError("Quá số lượng request")
    ):
        payload = {
            "job_id": "job-api-quota",
            "prompt": "Test quota limit"
        }
        res = client.post("/api/v1/nlp/generate", json=payload)
        assert res.status_code == 429
        data = res.json()
        assert data["detail"]["code"] == "QUOTA_EXCEEDED"


def test_api_generate_external_error_returns_502():
    with patch(
        "app.api.nlp_routes.llm_orchestrator.generate",
        side_effect=GeminiAPIError("Lỗi kết nối Gemini")
    ):
        payload = {
            "job_id": "job-api-ext-err",
            "prompt": "Test gemini error"
        }
        res = client.post("/api/v1/nlp/generate", json=payload)
        assert res.status_code == 502
        data = res.json()
        assert data["detail"]["code"] == "EXTERNAL_LLM_ERROR"


# ---------------------------------------------------------------- bảo vệ endpoint
def test_generate_requires_internal_token():
    res = anonymous_client.post("/api/v1/nlp/generate", json={"job_id": "j", "prompt": "x"})
    assert res.status_code == 401


def test_generate_rejects_wrong_internal_token():
    res = anonymous_client.post(
        "/api/v1/nlp/generate",
        json={"job_id": "j", "prompt": "x"},
        headers={"X-Internal-Token": "wrong"},
    )
    assert res.status_code == 401


def test_endpoints_denied_when_token_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", None)
    res = client.post("/api/v1/nlp/generate", json={"job_id": "j", "prompt": "x"})
    assert res.status_code == 401


# ---------------------------------------------------------------- /summary + callback aiUsage
def _llm_response(job_id, fallback=True):
    return LLMResponse(
        job_id=job_id,
        text="Tóm tắt",
        model_name="gemini-1.5-flash" if fallback else "qwen2.5:7b",
        model_version="gemini-1.5" if fallback else "local-v1",
        fallback_used=fallback,
        fallback_reason="LOCAL_TIMEOUT" if fallback else None,
        input_tokens=10,
        output_tokens=5,
        total_tokens=15,
        processing_time_ms=100,
        estimated_cost_usd=0.00001 if fallback else 0.0,
    )


def test_summary_dispatches_ai_usage_callback_to_backend_url_from_config(monkeypatch):
    monkeypatch.setattr(settings, "backend_base_url", "http://backend.internal/api/v1/")
    resp = _llm_response("11111111-1111-1111-1111-111111111111")
    result = {"jobId": resp.job_id, "summaryText": resp.text, "aiUsage": {"fallbackUsed": True}}

    with patch.object(nlp_pipeline_orchestrator, "run_summary", return_value=(result, resp)), \
         patch("app.api.nlp_routes.llm_orchestrator.dispatch_usage_callback", return_value=True) as dispatch:
        res = client.post("/api/v1/nlp/summary", json={
            "job_id": resp.job_id,
            "transcript_text": "Họp sprint",
            "execution_id": "exec-1",
            # client cố chèn URL độc hại: phải bị bỏ qua
            "callback_url": "http://evil.example/steal",
        })

    assert res.status_code == 200
    body = res.json()
    assert body["callbackDispatched"] is True
    assert body["aiUsage"]["fallbackUsed"] is True

    args = dispatch.call_args.args
    assert args[0] == resp.job_id
    assert args[1] == "exec-1"
    assert args[3] == f"http://backend.internal/api/v1/jobs/{resp.job_id}/ai-usage"
    assert args[4] == TEST_TOKEN


def test_summary_without_execution_id_skips_callback():
    resp = _llm_response("job-s2", fallback=False)
    result = {"jobId": resp.job_id, "summaryText": resp.text, "aiUsage": {}}
    with patch.object(nlp_pipeline_orchestrator, "run_summary", return_value=(result, resp)), \
         patch("app.api.nlp_routes.llm_orchestrator.dispatch_usage_callback") as dispatch:
        res = client.post("/api/v1/nlp/summary", json={"job_id": "job-s2", "transcript_text": "x"})

    assert res.status_code == 200
    assert res.json()["callbackDispatched"] is False
    dispatch.assert_not_called()


def test_summary_callback_failure_does_not_fail_request():
    resp = _llm_response("job-s3")
    result = {"jobId": resp.job_id, "summaryText": resp.text, "aiUsage": {}}
    with patch.object(nlp_pipeline_orchestrator, "run_summary", return_value=(result, resp)), \
         patch("app.api.nlp_routes.llm_orchestrator.dispatch_usage_callback", return_value=False):
        res = client.post("/api/v1/nlp/summary", json={
            "job_id": "job-s3", "transcript_text": "x", "execution_id": "e"})

    assert res.status_code == 200
    assert res.json()["callbackDispatched"] is False


def test_summary_maps_quota_error_to_429():
    with patch.object(nlp_pipeline_orchestrator, "run_summary", side_effect=QuotaExceededError("q")):
        res = client.post("/api/v1/nlp/summary", json={"job_id": "job-s4", "transcript_text": "x"})
    assert res.status_code == 429
    assert res.json()["detail"]["code"] == "QUOTA_EXCEEDED"
