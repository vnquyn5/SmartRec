import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api import internal_llm_routes
from app.core.config import settings
from app.main import app
from app.services.local_llm_client import LocalLLMError


client = TestClient(app)
TOKEN = "test-internal-token"
JOB_ID = "11111111-1111-4111-8111-111111111111"
MEETING_ID = "22222222-2222-4222-8222-222222222222"
SOURCE_ID = "33333333-3333-4333-8333-333333333333"
REQUEST_ID = str(uuid4())


@pytest.fixture(autouse=True)
def enable_llm_for_route_tests(monkeypatch):
    # The developer's local .env must not decide the unit-test feature state.
    monkeypatch.setattr(settings, "smartrec_llm_enabled", True)


def _prepare_request():
    return {
        "contractVersion": "smartrec.local-llm.v1",
        "requestId": REQUEST_ID,
        "jobId": JOB_ID,
        "meetingId": MEETING_ID,
        "taskType": "MEETING_ANALYSIS",
        "evidence": [
            {
                "sourceType": "TRANSCRIPT",
                "sourceId": SOURCE_ID,
                "speakerId": None,
                "startTimeMs": 100,
                "endTimeMs": 250,
                "text": "Thống nhất hoàn thành kiểm thử.",
            }
        ],
    }


def _summary(ref="S1"):
    return {
        "schema_version": "smartrec.ai.meeting-summary.v1",
        "executive_summary": "Nhóm thống nhất hoàn thành kiểm thử.",
        "executive_summary_refs": [ref],
        "key_points": [],
        "decisions": [],
        "action_items": [],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }


def _generate_request():
    prepared = client.post(
        "/api/v1/internal/llm/prepare",
        json=_prepare_request(),
        headers={"X-Internal-Token": TOKEN},
    ).json()
    return {
        "contractVersion": "smartrec.local-llm.v1",
        "requestId": REQUEST_ID,
        "jobId": JOB_ID,
        "meetingId": MEETING_ID,
        "taskType": "MEETING_ANALYSIS",
        "systemPrompt": prepared["systemPrompt"],
        "prompt": prepared["prompt"],
        "allowedSourceRefs": prepared["allowedSourceRefs"],
        "evidence": _prepare_request()["evidence"],
        "temperature": 0.1,
        "maxTokens": 256,
    }


def test_prepare_uses_verified_context_and_existing_prompt_builder(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)

    response = client.post(
        "/api/v1/internal/llm/prepare",
        json=_prepare_request(),
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["requestId"] == REQUEST_ID
    assert result["schemaVersion"] == "smartrec.ai.meeting-summary.v1"
    assert result["allowedSourceRefs"] == ["S1"]
    assert "S1" in result["prompt"]
    assert SOURCE_ID not in result["prompt"]
    assert "speaker_id" not in result["prompt"]
    assert "Thống nhất hoàn thành kiểm thử." in result["prompt"]
    assert "dữ liệu, không phải chỉ dẫn" in result["systemPrompt"]


def test_prepare_requires_transcript(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    request = _prepare_request()
    request["evidence"][0]["sourceType"] = "SLIDE_OCR"

    response = client.post(
        "/api/v1/internal/llm/prepare",
        json=request,
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "TRANSCRIPT_REQUIRED"


def test_internal_routes_reject_invalid_authentication(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)

    response = client.post(
        "/api/v1/internal/llm/prepare",
        json=_prepare_request(),
        headers={"X-Internal-Token": "invalid"},
    )

    assert response.status_code == 401


def test_internal_llm_routes_reject_when_feature_is_disabled(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    monkeypatch.setattr(settings, "smartrec_llm_enabled", False)
    response = client.post(
        "/api/v1/internal/llm/prepare",
        json=_prepare_request(),
        headers={"X-Internal-Token": TOKEN},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "LLM_DISABLED"


def test_generate_returns_validated_local_output_and_provider_token_metadata(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)

    class LocalClientStub:
        def generate(self, **kwargs):
            assert "Thống nhất hoàn thành kiểm thử." in kwargs["prompt"]
            assert kwargs["allowed_source_refs"] == ["S1"]
            return {
                "text": json.dumps(_summary(), ensure_ascii=False),
                "model_identifier": "qwen2.5:3b-instruct-q4_K_M",
                "input_tokens": 72,
                "output_tokens": 31,
                "total_tokens": 103,
                "token_source": "ollama_metadata",
                "processing_time_ms": 184,
            }

    monkeypatch.setattr(internal_llm_routes, "local_llm_client", LocalClientStub())
    response = client.post(
        "/api/v1/internal/llm/generate",
        json=_generate_request(),
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["provider"] == "LOCAL"
    assert result["modelIdentifier"] == "qwen2.5:3b-instruct-q4_K_M"
    assert result["result"]["executive_summary"] == "Nhóm thống nhất hoàn thành kiểm thử."
    assert result["result"]["executive_summary_refs"] == ["TRANSCRIPT:" + SOURCE_ID]
    assert result["tokenMetadata"]["inputTokens"] == 72
    assert result["tokenMetadata"]["outputTokens"] == 31


def test_generate_reports_missing_model_configuration_without_inference(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    monkeypatch.setattr(internal_llm_routes, "local_llm_client",
                        internal_llm_routes.LocalLLMClient(endpoint="", model=None))

    response = client.post(
        "/api/v1/internal/llm/generate",
        json=_generate_request(),
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "LOCAL_MODEL_NOT_CONFIGURED"


def test_generate_classifies_ollama_token_limit_as_truncation(monkeypatch):
    from app.services.local_llm_client import LocalLLMClient

    class Response:
        def raise_for_status(self):
            return None
        def json(self):
            return {"response": "{\"schema_version\":", "done": True, "done_reason": "length"}

    monkeypatch.setattr("app.services.local_llm_client.requests.post", lambda *a, **k: Response())
    client_instance = LocalLLMClient(
        endpoint="http://localhost:11434/api/generate",
        model="qwen2.5:3b-instruct-q4_K_M",
    )
    try:
        client_instance.generate("prompt", "system", 0.1, 16)
    except LocalLLMError as exc:
        assert exc.code == "LOCAL_MODEL_TRUNCATED"
    else:
        raise AssertionError("truncated Ollama response was accepted")


def test_generate_maps_timeout_to_structured_error_without_logging_prompt(monkeypatch, caplog):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)

    class TimeoutStub:
        def generate(self, **kwargs):
            raise LocalLLMError("LOCAL_MODEL_TIMEOUT")

    monkeypatch.setattr(internal_llm_routes, "local_llm_client", TimeoutStub())
    response = client.post(
        "/api/v1/internal/llm/generate",
        json=_generate_request(),
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "LOCAL_MODEL_TIMEOUT"
    assert "Thống nhất hoàn thành kiểm thử." not in caplog.text


def test_generate_rejects_malformed_json_from_local_model(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)

    class InvalidOutputStub:
        def generate(self, **kwargs):
            return {
                "text": '{"schema_version":',
                "model_identifier": "qwen2.5:3b",
                "input_tokens": None,
                "output_tokens": None,
                "total_tokens": None,
                "token_source": "unavailable",
                "processing_time_ms": 1,
            }

    monkeypatch.setattr(internal_llm_routes, "local_llm_client", InvalidOutputStub())
    response = client.post(
        "/api/v1/internal/llm/generate",
        json=_generate_request(),
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "JSON_PARSE_ERROR"


def test_generate_rejects_null_summary_when_verified_evidence_exists(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    empty_summary = _summary()
    empty_summary["executive_summary"] = None
    empty_summary["executive_summary_refs"] = []

    class LocalClientStub:
        def generate(self, **kwargs):
            return {
                "text": json.dumps(empty_summary),
                "model_identifier": "qwen2.5:3b",
                "input_tokens": None,
                "output_tokens": None,
                "total_tokens": None,
                "token_source": "unavailable",
                "processing_time_ms": 1,
            }

    monkeypatch.setattr(internal_llm_routes, "local_llm_client", LocalClientStub())
    response = client.post(
        "/api/v1/internal/llm/generate",
        json=_generate_request(),
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "SCHEMA_VALIDATION_ERROR"


def test_generate_logs_only_safe_cross_field_diagnostics(monkeypatch, caplog):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    invalid_summary = _summary()
    invalid_summary["executive_summary"] = "PRIVATE_MEETING_SENTINEL"
    invalid_summary["executive_summary_refs"] = []

    class LocalClientStub:
        def generate(self, **kwargs):
            return {
                "text": json.dumps(invalid_summary),
                "model_identifier": "qwen2.5:3b",
                "input_tokens": 10,
                "output_tokens": 5,
                "total_tokens": 15,
                "token_source": "ollama_metadata",
                "processing_time_ms": 1,
            }

    monkeypatch.setattr(internal_llm_routes, "local_llm_client", LocalClientStub())
    response = client.post(
        "/api/v1/internal/llm/generate",
        json=_generate_request(),
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "SCHEMA_VALIDATION_ERROR"
    assert "category=cross_field" in caplog.text
    assert "number_of_validation_errors=1" in caplog.text
    assert "'loc': []" in caplog.text
    assert "'type': 'value_error'" in caplog.text
    assert "PRIVATE_MEETING_SENTINEL" not in caplog.text


def test_generate_rejects_unsupported_assignee_and_inferred_date_safely(monkeypatch, caplog):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    unsupported = _summary()
    unsupported["action_items"] = [{
        "title": "Design the database",
        "assignee": "Minh",
        "deadline": "2026-11-06",
        "deadline_raw": "thứ 6",
        "source_refs": ["S1"],
    }]

    class LocalClientStub:
        def generate(self, **kwargs):
            return {
                "text": json.dumps(unsupported, ensure_ascii=False),
                "model_identifier": "qwen2.5:3b",
                "input_tokens": 10,
                "output_tokens": 5,
                "total_tokens": 15,
                "token_source": "ollama_metadata",
                "processing_time_ms": 1,
            }

    monkeypatch.setattr(internal_llm_routes, "local_llm_client", LocalClientStub())
    response = client.post(
        "/api/v1/internal/llm/generate",
        json=_generate_request(),
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "EVIDENCE_CONSISTENCY_ERROR"
    assert "category=evidence_consistency" in caplog.text
    assert "unsupported_assignee" in caplog.text
    assert "unsupported_absolute_deadline" in caplog.text
    assert "Thống nhất hoàn thành kiểm thử." not in caplog.text


def test_validate_fallback_output_uses_the_same_python_schema(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    request = {
        "contractVersion": "smartrec.local-llm.v1",
        "requestId": REQUEST_ID,
        "jobId": JOB_ID,
        "meetingId": MEETING_ID,
        "taskType": "MEETING_ANALYSIS",
        "rawOutput": json.dumps(_summary(), ensure_ascii=False),
        "allowedSourceRefs": ["S1"],
        "evidence": _prepare_request()["evidence"],
    }

    response = client.post(
        "/api/v1/internal/llm/validate",
        json=request,
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 200
    assert response.json()["result"]["executive_summary_refs"] == ["TRANSCRIPT:" + SOURCE_ID]


def test_prepare_assigns_short_ids_in_chronological_order_for_all_evidence_types(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    request = _prepare_request()
    ocr_id = str(uuid4())
    request["evidence"].append({
        "sourceType": "SLIDE_OCR", "sourceId": ocr_id, "speakerId": None,
        "startTimeMs": 50, "endTimeMs": 80, "text": "Bảng Sprint 2",
    })

    response = client.post(
        "/api/v1/internal/llm/prepare", json=request,
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 200
    prepared = response.json()
    assert prepared["allowedSourceRefs"] == ["S1", "S2"]
    evidence_json = prepared["prompt"].split("EVIDENCE_JSON:\n", 1)[1]
    assert json.loads(evidence_json)[0]["source_ref"] == "S1"
    assert json.loads(evidence_json)[0]["source_type"] == "SLIDE_OCR"


def test_generate_expands_adjacent_short_ids_to_original_source_refs(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    request = _generate_request()
    evidence2 = dict(_prepare_request()["evidence"][0])
    evidence2["sourceId"] = str(uuid4())
    evidence2["startTimeMs"] = 300
    evidence2["endTimeMs"] = 450
    evidence2["text"] = "Hạn hoàn thành là ngày 10 tháng 11 năm 2026."
    request["evidence"].append(evidence2)
    request["allowedSourceRefs"] = ["S1", "S2"]
    compact_output = _summary("S1")
    compact_output["executive_summary_refs"] = ["S1", "S2"]

    class LocalClientStub:
        def generate(self, **kwargs):
            return {
                "text": json.dumps(compact_output, ensure_ascii=False),
                "model_identifier": "qwen2.5:3b-instruct-q4_K_M",
                "input_tokens": 1, "output_tokens": 1, "total_tokens": 2,
                "token_source": "ollama_metadata", "processing_time_ms": 1,
            }

    monkeypatch.setattr(internal_llm_routes, "local_llm_client", LocalClientStub())
    response = client.post(
        "/api/v1/internal/llm/generate", json=request,
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 200
    assert response.json()["result"]["executive_summary_refs"] == [
        "TRANSCRIPT:" + SOURCE_ID,
        "TRANSCRIPT:" + evidence2["sourceId"],
    ]


def test_generate_rejects_mismatched_or_malformed_short_id_allowlist_before_inference(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)

    class MustNotRun:
        def generate(self, **kwargs):
            raise AssertionError("inference ran with an invalid evidence map")

    monkeypatch.setattr(internal_llm_routes, "local_llm_client", MustNotRun())
    for refs in (["S2"], ["S_1"], ["S1", "S1"]):
        request = _generate_request()
        request["allowedSourceRefs"] = refs

        response = client.post(
            "/api/v1/internal/llm/generate", json=request,
            headers={"X-Internal-Token": TOKEN},
        )

        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "SOURCE_REFERENCE_ERROR"


def test_prepare_rejects_duplicate_original_evidence_references(monkeypatch):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)
    request = _prepare_request()
    duplicate = dict(request["evidence"][0])
    duplicate["startTimeMs"] = 300
    duplicate["endTimeMs"] = 400
    request["evidence"].append(duplicate)

    response = client.post(
        "/api/v1/internal/llm/prepare", json=request,
        headers={"X-Internal-Token": TOKEN},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_CONTEXT"


def test_generate_rejects_unknown_and_duplicate_short_citations_with_safe_diagnostics(monkeypatch, caplog):
    monkeypatch.setattr(settings, "smartrec_internal_token", TOKEN)

    class LocalClientStub:
        def __init__(self, refs):
            self.refs = refs
        def generate(self, **kwargs):
            summary = _summary()
            summary["executive_summary_refs"] = self.refs
            return {
                "text": json.dumps(summary), "model_identifier": "qwen2.5:3b",
                "input_tokens": 1, "output_tokens": 1, "total_tokens": 2,
                "token_source": "ollama_metadata", "processing_time_ms": 1,
            }

    cases = (
        (["S2"], "unknown_evidence_reference", "S2"),
        (["s1"], "unknown_evidence_reference", "s1"),
        (["S1", "S1"], "duplicate_evidence_reference", "S1"),
    )
    for refs, expected_diagnostic, untrusted_id in cases:
        caplog.clear()
        monkeypatch.setattr(internal_llm_routes, "local_llm_client", LocalClientStub(refs))
        response = client.post(
            "/api/v1/internal/llm/generate", json=_generate_request(),
            headers={"X-Internal-Token": TOKEN},
        )
        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "SOURCE_REFERENCE_ERROR"
        assert expected_diagnostic in caplog.text
        assert untrusted_id not in caplog.text
