from unittest.mock import Mock

from app.services.callback_client import CallbackClient


def test_ai_usage_callback_retries_same_idempotent_event(monkeypatch):
    first = Mock(status_code=503)
    second = Mock(status_code=204)
    calls = iter((first, second))
    post = Mock(side_effect=lambda *args, **kwargs: next(calls))
    monkeypatch.setattr("app.services.callback_client.requests.post", post)
    monkeypatch.setattr("app.services.callback_client.time.sleep", lambda _: None)
    client = CallbackClient(max_retries=2)
    payload = {"requestId": "stable-inference-id", "inputTokens": None, "outputTokens": None}

    assert client.send_ai_usage("http://backend/api/v1/", payload, "internal-secret")
    assert post.call_count == 2
    assert all(call.kwargs["json"] is payload for call in post.call_args_list)
    assert post.call_args_list[0].args[0] == "http://backend/api/v1/internal/ai-usage"


def test_ai_usage_callback_does_not_log_server_response_or_token(monkeypatch, caplog):
    post = Mock(return_value=Mock(status_code=500, text="contains-secret-payload"))
    monkeypatch.setattr("app.services.callback_client.requests.post", post)
    monkeypatch.setattr("app.services.callback_client.time.sleep", lambda _: None)
    client = CallbackClient(max_retries=1)

    assert not client.send_ai_usage("http://backend", {"requestId": "id-1"}, "internal-secret")
    assert "contains-secret-payload" not in caplog.text
    assert "internal-secret" not in caplog.text
