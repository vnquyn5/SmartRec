"""Unit tests cho WhisperASRService."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services.whisper_asr_service import WhisperASRService


@pytest.fixture
def mock_adapter():
    adapter = MagicMock()
    adapter.is_ready = True
    adapter.predict.return_value = (
        [SimpleNamespace(start=0.0, end=1.5, text="Xin chào")],
        SimpleNamespace(language="vi"),
    )
    return adapter


def test_transcribe_default_parameters(tmp_path, mock_adapter):
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"mock-audio")

    with patch(
        "app.services.whisper_asr_service.create_whisper_adapter",
        return_value=mock_adapter,
    ):
        service = WhisperASRService()
        result = service.transcribe(str(audio))

    mock_adapter.predict.assert_called_once_with(
        str(audio),
        language="vi",
        beam_size=5,
        word_timestamps=True,
    )

    assert result["language"] == "vi"
    assert result["detected_language"] == "vi"
    assert len(result["segments"]) == 1


def test_reuse_loaded_model(tmp_path, mock_adapter):
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"mock-audio")

    with patch(
        "app.services.whisper_asr_service.create_whisper_adapter",
        return_value=mock_adapter,
    ):
        service = WhisperASRService()
        service.load_model()
        service.transcribe(str(audio))
        service.transcribe(str(audio))

    mock_adapter.load_model.assert_called_once()
    assert mock_adapter.predict.call_count == 2


def test_missing_audio(mock_adapter):
    with patch(
        "app.services.whisper_asr_service.create_whisper_adapter",
        return_value=mock_adapter,
    ):
        service = WhisperASRService()

    with pytest.raises(FileNotFoundError):
        service.transcribe("nonexistent_audio.wav")


def test_model_not_loaded(tmp_path, mock_adapter):
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"mock-audio")
    mock_adapter.is_ready = False

    with patch(
        "app.services.whisper_asr_service.create_whisper_adapter",
        return_value=mock_adapter,
    ):
        service = WhisperASRService()

    with pytest.raises(RuntimeError, match="chưa được load"):
        service.transcribe(str(audio))


def test_invalid_beam_size():
    with pytest.raises(ValueError, match="beam_size"):
        WhisperASRService(beam_size=0)


def test_context_manager_cleanup_on_exception(mock_adapter):
    with patch(
        "app.services.whisper_asr_service.create_whisper_adapter",
        return_value=mock_adapter,
    ):
        service = WhisperASRService()

        with pytest.raises(ValueError, match="test error"):
            with service:
                raise ValueError("test error")

    mock_adapter.load_model.assert_called_once()
    mock_adapter.unload.assert_called_once()
