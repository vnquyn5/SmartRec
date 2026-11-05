import logging
from unittest.mock import Mock

import pytest
import requests

from app.core.config import settings
from app.services.local_llm_client import LocalLLMClient, LocalLLMError


ENDPOINT = "http://ollama.internal:11434/api/generate"
MODEL = "qwen2.5:3b-instruct-q4_K_M"


def _client(**overrides):
    return LocalLLMClient(
        endpoint=overrides.get("endpoint", ENDPOINT),
        model=overrides.get("model", MODEL),
        timeout_seconds=overrides.get("timeout_seconds", 120),
        connect_timeout_seconds=overrides.get("connect_timeout_seconds", 5),
    )


def _response(body):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = body
    return response


def test_posts_ollama_payload_and_returns_token_metadata(monkeypatch):
    post = Mock(return_value=_response({
        "response": '{"executive_summary":"grounded"}',
        "prompt_eval_count": 21,
        "eval_count": 13,
    }))
    monkeypatch.setattr("app.services.local_llm_client.requests.post", post)

    result = _client().generate("transcript prompt", "system rules", 0.1, 2048)

    post.assert_called_once_with(
        ENDPOINT,
        json={
            "model": MODEL,
            "prompt": "transcript prompt",
            "system": "system rules",
            "stream": False,
            "keep_alive": 0,
            "options": {"temperature": 0.1, "num_predict": 2048},
        },
        headers={"Content-Type": "application/json"},
        timeout=(5, 120),
    )
    assert result["model_identifier"] == MODEL
    assert result["input_tokens"] == 21
    assert result["output_tokens"] == 13
    assert result["total_tokens"] == 34
    assert result["token_source"] == "ollama_metadata"


def test_missing_model_is_rejected_before_http_request(monkeypatch):
    monkeypatch.setattr(settings, "local_llm_model", None)
    post = Mock()
    monkeypatch.setattr("app.services.local_llm_client.requests.post", post)

    with pytest.raises(LocalLLMError) as error:
        LocalLLMClient(endpoint=ENDPOINT).generate("prompt", "system", 0.1, 100)

    assert error.value.code == "LOCAL_MODEL_CONFIGURATION_INVALID"
    post.assert_not_called()


@pytest.mark.parametrize(
    ("status_code", "expected_code"),
    [(400, "LOCAL_MODEL_REQUEST_REJECTED"), (503, "LOCAL_MODEL_UNAVAILABLE")],
)
def test_http_errors_are_classified_without_logging_response_content(
    monkeypatch, caplog, status_code, expected_code
):
    response = _response({})
    response.raise_for_status.side_effect = requests.HTTPError(
        "sensitive prompt and response content",
        response=Mock(status_code=status_code),
    )
    monkeypatch.setattr("app.services.local_llm_client.requests.post", Mock(return_value=response))

    with caplog.at_level(logging.WARNING), pytest.raises(LocalLLMError) as error:
        _client().generate("sensitive prompt", "private system prompt", 0.1, 100)

    assert error.value.code == expected_code
    assert "sensitive prompt" not in caplog.text
    assert "private system prompt" not in caplog.text
    assert "response content" not in caplog.text


def test_timeout_is_bounded_and_does_not_log_prompt_or_secret(monkeypatch, caplog):
    post = Mock(side_effect=requests.Timeout("private prompt and token"))
    monkeypatch.setattr("app.services.local_llm_client.requests.post", post)

    with caplog.at_level(logging.WARNING), pytest.raises(LocalLLMError) as error:
        _client().generate("private prompt", "private system prompt", 0.1, 100)

    assert error.value.code == "LOCAL_MODEL_TIMEOUT"
    assert "private prompt" not in caplog.text
    assert "token" not in caplog.text


def test_invalid_qwen_size_is_rejected_before_http_request(monkeypatch):
    post = Mock()
    monkeypatch.setattr("app.services.local_llm_client.requests.post", post)

    with pytest.raises(LocalLLMError) as error:
        _client(model="qwen2.5:7b").generate("prompt", "system", 0.1, 100)

    assert error.value.code == "LOCAL_MODEL_CONFIGURATION_INVALID"
    post.assert_not_called()


@pytest.mark.parametrize(
    ("body", "expected_code"),
    [
        ({"response": ""}, "LOCAL_MODEL_INVALID_RESPONSE"),
        ({"response": "   "}, "LOCAL_MODEL_INVALID_RESPONSE"),
        (None, "LOCAL_MODEL_UNAVAILABLE"),
    ],
)
def test_empty_or_invalid_response_is_rejected(monkeypatch, body, expected_code):
    monkeypatch.setattr(
        "app.services.local_llm_client.requests.post",
        Mock(return_value=_response(body)),
    )

    with pytest.raises(LocalLLMError) as error:
        _client().generate("prompt", "system", 0.1, 100)

    assert error.value.code == expected_code


def test_invalid_json_response_is_rejected(monkeypatch):
    response = requests.Response()
    response.status_code = 200
    response._content = b"not-json"
    monkeypatch.setattr(
        "app.services.local_llm_client.requests.post",
        Mock(return_value=response),
    )

    with pytest.raises(LocalLLMError) as error:
        _client().generate("prompt", "system", 0.1, 100)

    assert error.value.code == "LOCAL_MODEL_INVALID_RESPONSE"


def test_invalid_endpoint_and_non_positive_timeout_are_rejected(monkeypatch):
    post = Mock()
    monkeypatch.setattr("app.services.local_llm_client.requests.post", post)

    for client, expected_code in (
        (_client(endpoint="http://ollama.internal/api/not-generate"), "LOCAL_MODEL_ENDPOINT_INVALID"),
        (_client(endpoint=ENDPOINT + "/"), "LOCAL_MODEL_ENDPOINT_INVALID"),
        (_client(timeout_seconds=0), "LOCAL_MODEL_CONFIGURATION_INVALID"),
    ):
        with pytest.raises(LocalLLMError) as error:
            client.generate("prompt", "system", 0.1, 100)
        assert error.value.code == expected_code

    post.assert_not_called()


def test_missing_token_counts_remain_null(monkeypatch):
    monkeypatch.setattr(
        "app.services.local_llm_client.requests.post",
        Mock(return_value=_response({"response": "result", "prompt_eval_count": True, "eval_count": -1})),
    )

    result = _client().generate("prompt", "system", 0.1, 100)

    assert result["input_tokens"] is None
    assert result["output_tokens"] is None
    assert result["total_tokens"] is None
    assert result["token_source"] == "unavailable"
