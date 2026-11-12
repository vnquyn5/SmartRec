
"""Tests for Whisper ASR backend and model provenance."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.adapters.whisper_adapter import (
    WhisperCppPredictor,
    WhisperPredictor,
)
from app.services.whisper_asr_service import WhisperASRService


@pytest.mark.parametrize(
    "expected_backend,predictor_class",
    [
        ("faster-whisper", WhisperPredictor),
        ("whisper.cpp", WhisperCppPredictor),
    ],
)
def test_transcribe_returns_backend_and_model_provenance(
    expected_backend, predictor_class
):
    predictor = predictor_class.__new__(predictor_class)

    with (
        patch(
            "app.services.whisper_asr_service.create_whisper_adapter"
        ) as factory,
        patch(
            "app.services.whisper_asr_service.Path.is_file",
            return_value=True,
        ),
    ):
        adapter = MagicMock()
        adapter.is_ready = True
        adapter.model_name = "test-model"
        adapter.version = "test-version"
        adapter.device = "cpu"
        adapter._predictor = predictor
        adapter.predict.return_value = (
            [SimpleNamespace(start=0.0, end=1.0, text="Test")],
            SimpleNamespace(language="vi"),
        )
        factory.return_value = adapter

        result = WhisperASRService().transcribe("/mock/audio.wav")

    assert result["adapter"] == expected_backend
    assert result["model"] == "test-model"
    assert result["model_version"] == "test-version"
    assert len(result["segments"]) == 1


def test_transcribe_reports_unknown_backend_without_guessing():
    with (
        patch(
            "app.services.whisper_asr_service.create_whisper_adapter"
        ) as factory,
        patch(
            "app.services.whisper_asr_service.Path.is_file",
            return_value=True,
        ),
    ):
        adapter = MagicMock()
        adapter.is_ready = True
        adapter.model_name = "test-model"
        adapter.version = "test-version"
        adapter.device = "cpu"
        adapter._predictor = SimpleNamespace()
        adapter.predict.return_value = (
            [SimpleNamespace(start=0.0, end=1.0, text="Test")],
            SimpleNamespace(language="vi"),
        )
        factory.return_value = adapter

        result = WhisperASRService().transcribe("/mock/audio.wav")

    assert result["adapter"] == "unknown"
    assert result["model"] == "test-model"
    assert result["model_version"] == "test-version"