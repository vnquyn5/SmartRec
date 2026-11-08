from types import SimpleNamespace
from unittest.mock import patch

import requests
import pytest

from app.services.callback_client import AIInferenceRequestError, CallbackClient


def test_stt_callback_uses_internal_endpoint():
    client = CallbackClient(max_retries=2)

    payload = {
        "meetingId": "meeting-1",
        "processingJobId": "job-1",
        "success": True,
        "segments": [],
    }

    with patch(
        "app.services.callback_client.requests.post",
        return_value=SimpleNamespace(status_code=200),
    ) as post:
        result = client.send_stt_result(
            "http://localhost:8082/api/v1",
            payload,
            internal_token="test-token",
        )

    assert result is True
    post.assert_called_once()

    args, kwargs = post.call_args
    assert args[0] == "http://localhost:8082/api/v1/internal/stt/callback"
    assert kwargs["json"] == payload
    assert kwargs["headers"]["X-Internal-Token"] == "test-token"


@pytest.mark.parametrize("base, expected", [
    ("http://localhost:8082/api/v1/", "http://localhost:8082/api/v1/internal/stt/callback"),
    ("http://localhost:8082", "http://localhost:8082/internal/stt/callback"),
    ("http://localhost:8082/", "http://localhost:8082/internal/stt/callback"),
])
def test_stt_callback_preserves_configured_servlet_context(base, expected):
    with patch("app.services.callback_client.requests.post",
               return_value=SimpleNamespace(status_code=200)) as post:
        assert CallbackClient().send_stt_result(base, {}, internal_token="test-token")
    assert post.call_args.args[0] == expected


def test_stt_callback_does_not_retry_unauthorized():
    client = CallbackClient(max_retries=3)

    with patch(
        "app.services.callback_client.requests.post",
        return_value=SimpleNamespace(status_code=401),
    ) as post:
        result = client.send_stt_result(
            "http://localhost:8082/api/v1",
            {"success": True},
            internal_token="invalid-token",
        )

    assert result is False
    post.assert_called_once()


def test_stt_callback_retries_transport_failure():
    client = CallbackClient(max_retries=2)

    with patch(
        "app.services.callback_client.requests.post",
        side_effect=[
            requests.ConnectionError("mock connection failure"),
            SimpleNamespace(status_code=200),
        ],
    ) as post, patch(
        "app.services.callback_client.time.sleep"
    ) as sleep:
        result = client.send_stt_result(
            "http://localhost:8082/api/v1",
            {"success": True},
            internal_token="test-token",
        )

    assert result is True
    assert post.call_count == 2
    sleep.assert_called_once()


def test_stt_callback_rejects_missing_token():
    client = CallbackClient()

    with patch(
        "app.services.callback_client.requests.post"
    ) as post:
        result = client.send_stt_result(
            "http://localhost:8082/api/v1",
            {"success": True},
            internal_token=None,
        )

    assert result is False
    post.assert_not_called()


def test_stt_callback_rejects_unexpected_base_path():
    client = CallbackClient()

    with patch(
        "app.services.callback_client.requests.post"
    ) as post:
        try:
            client.send_stt_result(
                "http://localhost:8082/unexpected",
                {"success": True},
                internal_token="test-token",
            )
        except ValueError:
            pass
        else:
            raise AssertionError("Expected ValueError")

    post.assert_not_called()


def test_stt_callback_forwards_execution_fence():
    with patch("app.services.callback_client.requests.post",
               return_value=SimpleNamespace(status_code=200)) as post:
        assert CallbackClient().send_stt_result(
            "http://localhost:8082/api/v1", {}, internal_token="test-token", execution_id="execution-1")
    assert post.call_args.kwargs["headers"]["X-Execution-Id"] == "execution-1"


def test_ai_result_request_targets_spring_router_and_forwards_lease():
    job_id = "11111111-1111-4111-8111-111111111111"
    execution_id = "33333333-3333-4333-8333-333333333333"
    response = SimpleNamespace(
        status_code=200,
        json=lambda: {"jobId": job_id, "status": "SUCCESS", "result": {}},
    )
    with patch("app.services.callback_client.requests.post", return_value=response) as post:
        result = CallbackClient().request_ai_result(
            "http://localhost:8082/api/v1/",
            job_id,
            "test-token",
            execution_id,
            timeout_sec=45,
        )

    assert result["status"] == "SUCCESS"
    assert post.call_args.args[0] == (
        f"http://localhost:8082/api/v1/internal/jobs/{job_id}/ai-result"
    )
    assert post.call_args.kwargs["json"] == {}
    assert post.call_args.kwargs["timeout"] == 45
    assert post.call_args.kwargs["allow_redirects"] is False
    assert post.call_args.kwargs["headers"]["X-Internal-Token"] == "test-token"
    assert post.call_args.kwargs["headers"]["X-Execution-Id"] == execution_id


def test_ai_result_request_default_timeout_covers_configured_router_budget():
    job_id = "11111111-1111-4111-8111-111111111111"
    execution_id = "33333333-3333-4333-8333-333333333333"
    response = SimpleNamespace(
        status_code=200,
        json=lambda: {"jobId": job_id, "status": "SUCCESS", "result": {}},
    )
    with patch("app.services.callback_client.requests.post", return_value=response) as post:
        CallbackClient().request_ai_result(
            "http://localhost:8082/api/v1",
            job_id,
            "test-token",
            execution_id,
        )

    assert post.call_args.kwargs["timeout"] == 900


@pytest.mark.parametrize(
        "status,retryable",
        [(401, False), (409, False), (429, True), (503, True)],
)
def test_ai_result_request_classifies_router_http_errors(status, retryable):
    with patch(
        "app.services.callback_client.requests.post",
        return_value=SimpleNamespace(status_code=status, json=lambda: {}),
    ):
        with pytest.raises(AIInferenceRequestError) as error:
            CallbackClient().request_ai_result(
                "http://localhost:8082/api/v1",
                "11111111-1111-4111-8111-111111111111",
                "test-token",
                "33333333-3333-4333-8333-333333333333",
            )
    assert error.value.retryable is retryable


def test_ai_result_request_rejects_untrusted_backend_path_before_network():
    with patch("app.services.callback_client.requests.post") as post:
        with pytest.raises(AIInferenceRequestError):
            CallbackClient().request_ai_result(
                "http://localhost:8082/unexpected",
                "11111111-1111-4111-8111-111111111111",
                "test-token",
                "33333333-3333-4333-8333-333333333333",
            )
    post.assert_not_called()


@pytest.mark.parametrize(
    "backend_url,timeout_sec",
    [("http://localhost:99999/api/v1", 10), ("http://localhost:8082/api/v1", float("nan"))],
)
def test_ai_result_request_rejects_invalid_url_or_timeout(backend_url, timeout_sec):
    with patch("app.services.callback_client.requests.post") as post:
        with pytest.raises(AIInferenceRequestError):
            CallbackClient().request_ai_result(
                backend_url,
                "11111111-1111-4111-8111-111111111111",
                "test-token",
                "33333333-3333-4333-8333-333333333333",
                timeout_sec=timeout_sec,
            )
    post.assert_not_called()


def test_ai_result_request_does_not_retry_permanent_fallback_denial():
    with patch(
        "app.services.callback_client.requests.post",
        return_value=SimpleNamespace(
            status_code=503,
            json=lambda: {"code": "GEMINI_FALLBACK_DENIED"},
        ),
    ):
        with pytest.raises(AIInferenceRequestError) as error:
            CallbackClient().request_ai_result(
                "http://localhost:8082/api/v1",
                "11111111-1111-4111-8111-111111111111",
                "test-token",
                "33333333-3333-4333-8333-333333333333",
            )
    assert error.value.retryable is False
