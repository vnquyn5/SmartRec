import pytest

import app.pipelines.nlp_pipeline as nlp_pipeline
from app.pipelines.nlp_pipeline import AIModelRouter, AIModelRoutingError


def valid_schema(value, task_type):
    assert task_type in {"summary", "task_matrix"}
    assert isinstance(value, dict) and "items" in value
    return True


def test_local_success_validates_and_does_not_call_gemini():
    gemini_calls = []
    router = AIModelRouter(
        lambda context, timeout: {"text": '{"items": []}'},
        valid_schema,
        gemini_provider=lambda *_: gemini_calls.append(True),
        fallback_allowed=True,
        gemini_model_name="configured-gemini",
    )

    result = router.generate(job_id="job", meeting_id="meeting", context_payload={"text": "x"}, task_type="summary")

    assert result.provider == "LOCAL"
    assert result.result == {"items": []}
    assert gemini_calls == []


def test_invalid_local_json_falls_back_only_when_explicitly_allowed():
    gemini_calls = []
    router = AIModelRouter(
        lambda *_: {"text": "not json"},
        valid_schema,
        gemini_provider=lambda *_: gemini_calls.append(True) or {"text": '{"items": []}'},
        fallback_allowed=True,
        gemini_model_name="gemini-from-config",
        inference_retries=1,
    )

    result = router.generate(job_id="job", meeting_id="meeting", context_payload={"text": "x"}, task_type="summary")

    assert result.provider == "GEMINI"
    assert result.fallback_used is True
    assert result.fallback_reason == "OUTPUT_INVALID_JSON"
    assert gemini_calls == [True]


def test_fallback_disabled_does_not_call_gemini():
    gemini_calls = []
    router = AIModelRouter(
        lambda *_: (_ for _ in ()).throw(TimeoutError()),
        valid_schema,
        gemini_provider=lambda *_: gemini_calls.append(True),
        fallback_allowed=False,
        gemini_model_name="gemini",
    )

    with pytest.raises(AIModelRoutingError):
        router.generate(job_id="job", meeting_id="meeting", context_payload={"text": "x"}, task_type="summary")
    assert gemini_calls == []


def test_provider_request_rejection_does_not_fallback():
    gemini_calls = []
    router = AIModelRouter(
        lambda *_: (_ for _ in ()).throw(ValueError("invalid provider request")),
        valid_schema,
        gemini_provider=lambda *_: gemini_calls.append(True),
        fallback_allowed=True,
        gemini_model_name="gemini",
    )

    with pytest.raises(AIModelRoutingError, match="rejected"):
        router.generate(job_id="job", meeting_id="meeting", context_payload={"x": 1}, task_type="summary")
    assert gemini_calls == []


def test_validator_rejection_is_retried_then_falls_back():
    validator_calls = []
    gemini_calls = []

    def validator(value, task_type):
        validator_calls.append(value)
        if len(validator_calls) < 3:
            raise ValueError("schema details")
        return True

    router = AIModelRouter(
        lambda *_: {"items": []}, validator,
        gemini_provider=lambda *_: gemini_calls.append(True) or {"items": []},
        fallback_allowed=True,
        gemini_model_name="gemini",
        inference_retries=1,
    )

    result = router.generate(job_id="job", meeting_id="meeting", context_payload={"x": 1}, task_type="summary")

    assert result.provider == "GEMINI"
    assert result.fallback_reason == "OUTPUT_SCHEMA_INVALID"
    assert len(validator_calls) == 3
    assert gemini_calls == [True]


def test_unexpected_local_exception_does_not_fallback():
    gemini_calls = []
    router = AIModelRouter(
        lambda *_: (_ for _ in ()).throw(KeyError("implementation detail")),
        valid_schema,
        gemini_provider=lambda *_: gemini_calls.append(True),
        fallback_allowed=True,
        gemini_model_name="gemini",
    )

    with pytest.raises(AIModelRoutingError, match="non-fallback"):
        router.generate(job_id="job", meeting_id="meeting", context_payload={"x": 1}, task_type="summary")
    assert gemini_calls == []


def test_retries_have_distinct_usage_ids_and_usage_callback_is_reused():
    class Callback:
        def __init__(self):
            self.events = []

        def send_ai_usage(self, base_url, payload, token):
            self.events.append((base_url, payload, token))
            return True

    callback = Callback()
    calls = []

    def flaky_provider(*_):
        calls.append(1)
        if len(calls) == 1:
            raise ConnectionError("hidden details")
        return {"text": '{"items": []}', "usage_metadata": {
            "prompt_token_count": 2,
            "candidates_token_count": 3,
            "total_token_count": 5,
        }}

    router = AIModelRouter(
        flaky_provider, valid_schema, inference_retries=1,
        callback_client=callback, backend_base_url="http://backend/api/v1",
        internal_token="secret",
    )
    result = router.generate(job_id="job-1", meeting_id="meeting-1", context_payload={"x": 1}, task_type="summary")

    assert result.provider == "LOCAL"
    assert len(callback.events) == 2
    first, second = [event[1] for event in callback.events]
    assert first["requestId"] != second["requestId"]
    assert all(event[1]["jobId"] == "job-1" for event in callback.events)
    assert second["inputTokens"] == 2
    assert second["outputTokens"] == 3
    assert second["totalTokens"] == 5
    assert second["tokenSource"] == "gemini_metadata"  # normalized generic snake-case metadata
    assert second["status"] == "success"


def test_provider_error_logs_do_not_include_context_or_exception_message(caplog):
    router = AIModelRouter(
        lambda *_: (_ for _ in ()).throw(RuntimeError("private transcript and key")),
        valid_schema,
        fallback_allowed=False,
    )
    with pytest.raises(AIModelRoutingError):
        router.generate(job_id="job", meeting_id="meeting", context_payload="private transcript", task_type="summary")
    assert "private transcript" not in caplog.text
    assert "key" not in caplog.text


def test_uppercase_value_error_message_is_not_used_as_log_code(caplog):
    router = AIModelRouter(
        lambda *_: (_ for _ in ()).throw(ValueError("PRIVATE TRANSCRIPT API KEY")),
        valid_schema,
        fallback_allowed=False,
    )
    with pytest.raises(AIModelRoutingError):
        router.generate(job_id="job", meeting_id="meeting", context_payload={"secret": "x"}, task_type="summary")

    assert "PRIVATE TRANSCRIPT API KEY" not in caplog.text
    assert "API KEY" not in caplog.text


def test_local_circuit_opens_after_threshold_and_routes_to_allowed_fallback():
    local_calls = []
    gemini_calls = []

    def failing_local(*_):
        local_calls.append(1)
        raise ConnectionError("offline")

    router = AIModelRouter(
        failing_local,
        valid_schema,
        gemini_provider=lambda *_: gemini_calls.append(1) or {"text": '{"items": []}'},
        fallback_allowed=True,
        gemini_model_name="configured-gemini",
        circuit_failure_threshold=1,
        circuit_reset_seconds=60,
    )

    first = router.generate(job_id="job", meeting_id="meeting", context_payload={"x": 1}, task_type="summary")
    second = router.generate(job_id="job", meeting_id="meeting", context_payload={"x": 1}, task_type="summary")

    assert first.provider == second.provider == "GEMINI"
    assert len(local_calls) == 1
    assert len(gemini_calls) == 2
    assert second.fallback_reason == "LOCAL_CIRCUIT_OPEN"


def test_local_circuit_recovers_after_reset_period(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(nlp_pipeline.time, "monotonic", lambda: now[0])
    local_calls = []

    def recovering_local(*_):
        local_calls.append(1)
        if len(local_calls) == 1:
            raise ConnectionError("offline")
        return {"items": []}

    router = AIModelRouter(
        recovering_local,
        valid_schema,
        circuit_failure_threshold=1,
        circuit_reset_seconds=10,
    )
    with pytest.raises(AIModelRoutingError):
        router.generate(job_id="job", meeting_id="meeting", context_payload={"x": 1}, task_type="summary")

    now[0] = 111.0
    result = router.generate(job_id="job", meeting_id="meeting", context_payload={"x": 1}, task_type="summary")

    assert result.provider == "LOCAL"
    assert len(local_calls) == 2

