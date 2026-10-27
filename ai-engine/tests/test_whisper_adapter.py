"""Unit tests cho faster-whisper adapter."""

from unittest.mock import MagicMock, patch

import pytest

from app.adapters.base import ModelStatus
from app.adapters.whisper_adapter import (
    WhisperPredictor,
    create_whisper_adapter,
)


def test_missing_model_path(monkeypatch):
    monkeypatch.delenv("WHISPER_MODEL_PATH", raising=False)

    with pytest.raises(ValueError, match="WHISPER_MODEL_PATH"):
        create_whisper_adapter()


def test_invalid_model_directory(tmp_path):
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


def test_adapter_lifecycle(tmp_path):
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
        )

        adapter.unload()

        assert adapter.status == ModelStatus.UNINITIALIZED


@pytest.mark.parametrize(
    ("requested_device", "expected_device"),
    [
        ("cpu", "cpu"),
        ("mps", "cpu"),
        ("cuda", "cuda"),
    ],
)
def test_whisper_adapter_reports_actual_device(
    tmp_path, requested_device, expected_device
):
    (tmp_path / "model.bin").write_bytes(b"mock")

    adapter = create_whisper_adapter(
        model_path=str(tmp_path),
        device=requested_device,
    )

    assert adapter.device == expected_device


def test_whisper_adapter_auto_device_without_cuda(tmp_path):
    (tmp_path / "model.bin").write_bytes(b"mock")

    with patch(
        "app.adapters.whisper_adapter.torch.cuda.is_available",
        return_value=False,
    ):
        adapter = create_whisper_adapter(model_path=str(tmp_path))

    assert adapter.device == "cpu"
