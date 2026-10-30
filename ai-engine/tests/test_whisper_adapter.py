"""Unit tests cho faster-whisper adapter."""

from unittest.mock import MagicMock, patch

import pytest

from app.adapters.base import ModelStatus
from app.adapters.whisper_adapter import (
    WhisperPredictor,
    WhisperCppHttpAdapter,
    create_whisper_adapter,
)


def test_missing_model_path(monkeypatch):
    monkeypatch.delenv("WHISPER_MODEL_PATH", raising=False)
    monkeypatch.delenv("STT_MODEL_PATH", raising=False)
    monkeypatch.setenv("STT_PROVIDER", "faster_whisper_cpu")

    with pytest.raises(ValueError, match="WHISPER_MODEL_PATH"):
        create_whisper_adapter()


def test_invalid_model_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("STT_PROVIDER", "faster_whisper_cpu")
    with pytest.raises(FileNotFoundError):
        create_whisper_adapter(model_path=str(tmp_path))


def test_predictor_transcribe_and_materialize_segments():
    model = MagicMock()
    model.transcribe.return_value = (
        iter(["segment_1", "segment_2"]),
        {"language": "vi"},
    )

    predictor = WhisperPredictor(model)

    segments, info = predictor.predict(
        "audio.wav",
        language="vi",
        beam_size=5,
        word_timestamps=True,
    )

    assert segments == ["segment_1", "segment_2"]
    assert info == {"language": "vi"}

    model.transcribe.assert_called_once_with(
        "audio.wav",
        language="vi",
        beam_size=5,
        word_timestamps=True,
    )


def test_adapter_lifecycle(tmp_path, monkeypatch):
    monkeypatch.setenv("STT_PROVIDER", "faster_whisper_cpu")
    (tmp_path / "model.bin").write_bytes(b"mock")

    fake_model = MagicMock()
    fake_model.transcribe.return_value = (
        iter(["segment_1"]),
        {"language": "vi"},
    )

    with patch(
        "app.adapters.whisper_adapter.WhisperModel",
        return_value=fake_model,
    ) as model_constructor:
        adapter = create_whisper_adapter(
            model_path=str(tmp_path),
            device="cpu",
        )

        adapter.load_model()

        assert adapter.status == ModelStatus.READY

        segments, info = adapter.predict("audio.wav")

        assert segments == ["segment_1"]
        assert info["language"] == "vi"

        model_constructor.assert_called_once_with(
            str(tmp_path.resolve()),
            device="cpu",
            compute_type="int8",
            local_files_only=True,
            cpu_threads=4,
            num_workers=1,
        )

        adapter.unload()

        assert adapter.status == ModelStatus.UNINITIALIZED


def test_whisper_cpp_http_adapter_preserves_segment_timestamps(tmp_path):
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"wav")
    response = MagicMock()
    response.json.return_value = {
        "language": "vi",
        "transcription": [{
            "timestamps": {"from": "00:00:01,250", "to": "00:00:02,500"},
            "text": " Xin chào SmartRec ",
        }],
    }
    with patch("app.adapters.whisper_adapter.requests.post", return_value=response) as post:
        adapter = WhisperCppHttpAdapter("http://localhost:8081/inference", 30)
        segments, info = adapter.predict(str(audio), language="vi")

    post.assert_called_once()
    assert post.call_args.kwargs["data"]["response_format"] == "verbose_json"
    assert segments[0].start == 1.25
    assert segments[0].end == 2.5
    assert segments[0].text == "Xin chào SmartRec"
    assert info.language == "vi"


def test_select_whisper_cpp_provider(monkeypatch):
    monkeypatch.setenv("STT_PROVIDER", "whisper_cpp")
    adapter = create_whisper_adapter()
    assert isinstance(adapter, WhisperCppHttpAdapter)
