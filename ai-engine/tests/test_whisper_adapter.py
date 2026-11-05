"""Unit tests cho faster-whisper adapter."""

import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.adapters.base import ModelInferenceError, ModelStatus
from app.adapters.whisper_adapter import (
    WhisperCppPredictor,
    WhisperPredictor,
    create_whisper_adapter,
)


@pytest.fixture(autouse=True)
def isolated_model_configuration(monkeypatch):
    # Temporary fixture folders are not model IDs. Select a supported ID
    # explicitly and do not inherit developer device/precision settings.
    monkeypatch.setenv("STT_MODEL_ID", "faster-whisper-small")
    monkeypatch.setenv("STT_BACKEND", "faster-whisper")
    monkeypatch.delenv("WHISPER_DEVICE", raising=False)
    monkeypatch.delenv("WHISPER_COMPUTE_TYPE", raising=False)


def test_unsupported_model_id_remains_rejected(tmp_path, monkeypatch):
    (tmp_path / "model.bin").write_bytes(b"mock")
    monkeypatch.setenv("STT_MODEL_ID", "unsupported-test-model")
    with patch("app.adapters.whisper_adapter.WhisperModel") as constructor:
        with pytest.raises(ValueError, match="Model STT không được hỗ trợ"):
            create_whisper_adapter(model_path=str(tmp_path))
    constructor.assert_not_called()


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


def _whispercpp_result():
    return {
        "result": {"language": "vi"},
        "transcription": [
            {"offsets": {"from": 0, "to": 1250}, "text": " Xin chào."},
            {"offsets": {"from": 1250, "to": 2400}, "text": " SmartRec."},
        ],
    }


def test_whispercpp_large_v3_turbo_uses_existing_model_and_keeps_timestamps(
    tmp_path, monkeypatch
):
    model_path = tmp_path / "ggml-large-v3-turbo-q5_0.bin"
    model_path.write_bytes(b"model")
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")
    monkeypatch.setenv("STT_BACKEND", "whisper.cpp")
    monkeypatch.setenv("STT_MODEL_ID", "whisper.cpp-large-v3-turbo-q5_0")
    monkeypatch.setenv("WHISPER_CPP_DEVICE", "metal")
    monkeypatch.setenv("WHISPER_CPP_BIN", "whisper-cli")
    monkeypatch.setenv("WHISPER_CPP_THREADS", "2")
    monkeypatch.setenv("WHISPER_CPP_TIMEOUT_SECONDS", "20")
    monkeypatch.setattr("app.adapters.whisper_adapter.shutil.which", lambda _: "/usr/bin/whisper-cli")

    adapter = create_whisper_adapter(model_path=str(model_path))
    adapter.load_model()
    predictor = adapter._predictor
    predictor._run = MagicMock(return_value=(
        _whispercpp_result(), "use gpu    = 1\nggml_metal_init", 0, False,
    ))

    segments, info = adapter.predict(str(audio_path), language="vi")

    assert [(item.start, item.end, item.text) for item in segments] == [
        (0.0, 1.25, "Xin chào."),
        (1.25, 2.4, "SmartRec."),
    ]
    assert info.language == "vi"
    assert adapter.model_name == "whisper.cpp-large-v3-turbo-q5_0"
    assert adapter.device == "metal"
    predictor._run.assert_called_once_with(str(audio_path), "vi")
    adapter.unload()


@pytest.mark.parametrize(
    "metal_result",
    [
        (None, "Metal failed to allocate buffer: out of memory", 134, True),
        (None, "", -6, True),  # Metal can abort before its diagnostic is captured.
    ],
)
def test_whispercpp_auto_device_retries_cpu_after_confirmed_metal_failure(
    tmp_path, monkeypatch, metal_result
):
    model_path = tmp_path / "ggml-large-v3-turbo-q5_0.bin"
    model_path.write_bytes(b"model")
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")
    monkeypatch.setenv("STT_BACKEND", "whisper.cpp")
    monkeypatch.setenv("STT_MODEL_ID", "whisper.cpp-large-v3-turbo-q5_0")
    monkeypatch.setenv("WHISPER_CPP_DEVICE", "auto")
    monkeypatch.setenv("WHISPER_CPP_BIN", "whisper-cli")
    monkeypatch.setattr("app.adapters.whisper_adapter.shutil.which", lambda _: "/usr/bin/whisper-cli")
    adapter = create_whisper_adapter(model_path=str(model_path))
    adapter.load_model()
    predictor = adapter._predictor
    predictor._run = MagicMock(side_effect=[
        metal_result,
        (_whispercpp_result(), "CPU only", 0, False),
    ])

    with patch("app.adapters.whisper_adapter.logger.warning") as warning:
        segments, _ = adapter.predict(str(audio_path), language="vi")

    assert len(segments) == 2
    warning.assert_called_once()
    predictor._run.assert_any_call(str(audio_path), "vi")
    predictor._run.assert_any_call(str(audio_path), "vi", force_cpu=True)
    adapter.unload()


def test_whispercpp_explicit_metal_does_not_silently_fallback(
    tmp_path, monkeypatch
):
    model_path = tmp_path / "ggml-large-v3-turbo-q5_0.bin"
    model_path.write_bytes(b"model")
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")
    monkeypatch.setenv("STT_BACKEND", "whisper.cpp")
    monkeypatch.setenv("STT_MODEL_ID", "whisper.cpp-large-v3-turbo-q5_0")
    monkeypatch.setenv("WHISPER_CPP_DEVICE", "metal")
    monkeypatch.setattr("app.adapters.whisper_adapter.shutil.which", lambda _: "/usr/bin/whisper-cli")
    adapter = create_whisper_adapter(model_path=str(model_path))
    adapter.load_model()
    adapter._predictor._run = MagicMock(return_value=(
        None, "Metal failed to allocate buffer: out of memory", 134, True,
    ))

    with pytest.raises(ModelInferenceError, match="WHISPER_CPP_METAL_FAILED:134"):
        adapter.predict(str(audio_path), language="vi")

    adapter._predictor._run.assert_called_once_with(str(audio_path), "vi")
    adapter.unload()


def test_whispercpp_cli_writes_private_json_and_uses_timeout(tmp_path):
    model_path = tmp_path / "ggml-large-v3-turbo-q5_0.bin"
    model_path.write_bytes(b"model")
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")
    predictor = WhisperCppPredictor(
        model_path=model_path,
        executable="/usr/bin/whisper-cli",
        device="cpu",
        threads=2,
        timeout_seconds=45,
        cpu_fallback=False,
    )

    def run(command, **kwargs):
        assert "--no-gpu" in command
        assert "--no-prints" in command
        assert kwargs["timeout"] == 45
        output_base = Path(command[command.index("--output-file") + 1])
        output_base.with_suffix(".json").write_text(json.dumps(_whispercpp_result()))
        return subprocess.CompletedProcess(command, 0)

    with patch("app.adapters.whisper_adapter.subprocess.run", side_effect=run):
        result, runtime_log, code, memory_error = predictor._run(str(audio_path), "vi")

    segments, info = predictor._parse(result)
    assert code == 0 and not memory_error
    assert len(segments) == 2 and info.language == "vi"


def test_whispercpp_timeout_is_not_misreported_as_empty_transcript(tmp_path):
    model_path = tmp_path / "model.bin"
    model_path.write_bytes(b"model")
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")
    predictor = WhisperCppPredictor(
        model_path=model_path,
        executable="whisper-cli",
        device="cpu",
        threads=1,
        timeout_seconds=0.01,
        cpu_fallback=False,
    )

    with patch(
        "app.adapters.whisper_adapter.subprocess.run",
        side_effect=subprocess.TimeoutExpired("whisper-cli", 0.01),
    ), pytest.raises(TimeoutError, match="WHISPER_CPP_TIMEOUT"):
        predictor._run(str(audio_path), "vi")
