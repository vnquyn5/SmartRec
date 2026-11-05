"""Selectable Faster-Whisper and whisper.cpp adapters for local STT."""

from __future__ import annotations

import json
import logging
import os
import signal
import shutil
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional

import torch
from faster_whisper import WhisperModel

from app.adapters.local_adapter import LocalModelAdapter

logger = logging.getLogger("smartrec.whisper_adapter")


class WhisperPredictor:
    """Adapter from the common SmartRec predictor interface to CTranslate2."""

    def __init__(self, model: WhisperModel):
        self.model = model

    def predict(self, input_data: Any, **kwargs: Any):
        segments, info = self.model.transcribe(input_data, **kwargs)
        # Materialize the lazy generator while the CTranslate2 model is loaded.
        return list(segments), info


class WhisperCppPredictor:
    """Run whisper.cpp in-process via a bounded CLI subprocess (no HTTP server).

    The child owns the large model allocation. It exits after each inference,
    releasing Metal/CPU model memory before OCR or the next job starts.
    """

    def __init__(
        self,
        *,
        model_path: Path,
        executable: str,
        device: str,
        threads: int,
        timeout_seconds: float,
        cpu_fallback: bool,
    ):
        self.model_path = model_path
        self.executable = executable
        self.device = device
        self.threads = threads
        self.timeout_seconds = timeout_seconds
        self.cpu_fallback = cpu_fallback
        self.actual_device = "not_run"

    def _run(self, audio_path: str, language: str, *, force_cpu: bool = False):
        with tempfile.TemporaryDirectory(prefix="smartrec-whispercpp-") as temp_dir:
            base = Path(temp_dir) / "transcription"
            log_path = Path(temp_dir) / "whisper.log"
            command = [
                self.executable,
                "--model", str(self.model_path),
                "--file", str(Path(audio_path).resolve()),
                "--language", language,
                "--threads", str(self.threads),
                "--output-json",
                "--output-file", str(base),
                "--no-prints",
            ]
            if force_cpu or self.device == "cpu":
                command.append("--no-gpu")

            try:
                with log_path.open("w", encoding="utf-8") as log_stream:
                    completed = subprocess.run(
                        command,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=log_stream,
                        timeout=self.timeout_seconds,
                        check=False,
                    )
            except subprocess.TimeoutExpired as exc:
                raise TimeoutError("WHISPER_CPP_TIMEOUT") from exc
            except OSError as exc:
                raise RuntimeError("WHISPER_CPP_EXECUTION_FAILED") from exc

            runtime_log = log_path.read_text(encoding="utf-8", errors="replace")
            if completed.returncode != 0:
                # Do not log model output or transcript text. Keep just a safe
                # classification and the child's exit status.
                is_metal_memory_error = (
                    "metal" in runtime_log.lower()
                    and any(term in runtime_log.lower() for term in (
                        "out of memory", "failed to allocate", "ggml_assert",
                    ))
                )
                # whisper.cpp aborts may be surfaced as a signal exit before
                # its Metal diagnostic reaches the redirected log. In auto
                # mode, retry this child on CPU and accept only a valid result.
                retryable_gpu_abort = completed.returncode == -signal.SIGABRT
                return (
                    None, runtime_log, completed.returncode,
                    is_metal_memory_error or retryable_gpu_abort,
                )

            json_path = base.with_suffix(".json")
            if not json_path.is_file():
                raise RuntimeError("WHISPER_CPP_JSON_MISSING")
            try:
                result = json.loads(json_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise RuntimeError("WHISPER_CPP_JSON_INVALID") from exc
            return result, runtime_log, completed.returncode, False

    @staticmethod
    def _parse(result: dict[str, Any]):
        raw_segments = result.get("transcription")
        if not isinstance(raw_segments, list):
            raise RuntimeError("WHISPER_CPP_SEGMENTS_MISSING")

        segments = []
        previous_start = -1.0
        for index, raw in enumerate(raw_segments):
            if not isinstance(raw, dict):
                raise RuntimeError("WHISPER_CPP_SEGMENT_INVALID")
            offsets = raw.get("offsets") or {}
            try:
                start = float(offsets["from"]) / 1000.0
                end = float(offsets["to"]) / 1000.0
            except (KeyError, TypeError, ValueError) as exc:
                raise RuntimeError("WHISPER_CPP_TIMESTAMP_INVALID") from exc
            text = str(raw.get("text") or "").strip()
            if not text:
                continue
            if start < 0 or end < start or start < previous_start:
                raise RuntimeError(f"WHISPER_CPP_TIMESTAMP_INVALID:{index}")
            previous_start = start
            segments.append(SimpleNamespace(start=start, end=end, text=text))

        result_info = result.get("result") or {}
        language = result_info.get("language")
        info = SimpleNamespace(language=language)
        return segments, info

    @staticmethod
    def _metal_confirmed(runtime_log: str) -> bool:
        log = runtime_log.lower()
        return "metal" in log and (
            "use gpu    = 1" in log
            or "ggml_metal_init" in log
            or "ggml_metal_device_init" in log
        )

    def predict(self, input_data: Any, **kwargs: Any):
        audio_path = str(input_data)
        language = str(kwargs.get("language") or "vi")
        if not Path(audio_path).is_file():
            raise FileNotFoundError("WHISPER_CPP_AUDIO_MISSING")

        result, runtime_log, return_code, retryable_gpu_failure = self._run(audio_path, language)
        actual_device = "cpu" if self.device == "cpu" else "metal"
        if result is None:
            if self.device == "metal":
                raise RuntimeError(f"WHISPER_CPP_METAL_FAILED:{return_code}")
            if not (self.device == "auto" and self.cpu_fallback and retryable_gpu_failure):
                raise RuntimeError(f"WHISPER_CPP_FAILED:{return_code}")
            logger.warning(
                "STT backend=whisper.cpp Metal child failed; retrying on CPU "
                "with GPU disabled (exit_code=%s)", return_code,
            )
            result, runtime_log, return_code, _ = self._run(
                audio_path, language, force_cpu=True,
            )
            if result is None:
                raise RuntimeError(f"WHISPER_CPP_CPU_FALLBACK_FAILED:{return_code}")
            actual_device = "cpu"
        elif self.device == "metal" and not self._metal_confirmed(runtime_log):
            raise RuntimeError("WHISPER_CPP_METAL_NOT_CONFIRMED")
        elif self.device == "auto":
            if not self._metal_confirmed(runtime_log):
                if "use gpu    = 0" in runtime_log.lower():
                    actual_device = "cpu"
                    logger.info("STT backend=whisper.cpp runtime explicitly selected CPU")
                else:
                    actual_device = "unconfirmed"
                    logger.warning(
                        "STT backend=whisper.cpp completed, but runtime log did not confirm "
                        "Metal or CPU; device is reported as unconfirmed",
                    )

        self.actual_device = actual_device
        segments, info = self._parse(result)
        logger.info(
            "STT inference backend=whisper.cpp model=large-v3-turbo-q5_0 device=%s "
            "segments=%d",
            actual_device, len(segments),
        )
        if not segments:
            raise RuntimeError("WHISPER_CPP_EMPTY_TRANSCRIPT")
        return segments, info


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean")


def create_whisper_adapter(
    model_path: Optional[str] = None,
    device: Optional[str] = None,
    compute_type: Optional[str] = None,
) -> LocalModelAdapter:
    """Build the configured STT backend; unsupported formats fail closed."""
    backend = os.getenv("STT_BACKEND", "faster-whisper").strip().lower()
    configured_path = model_path or os.getenv("WHISPER_MODEL_PATH")
    if not configured_path:
        raise ValueError("Thiếu WHISPER_MODEL_PATH cho STT model.")
    weights_path = Path(configured_path).expanduser().resolve()

    if backend in {"whisper.cpp", "whisper-cpp", "whisper_cpp"}:
        if not weights_path.is_file():
            raise FileNotFoundError(f"Không tìm thấy file whisper.cpp model: {weights_path}")
        model_id = os.getenv("STT_MODEL_ID", "whisper.cpp-large-v3-turbo-q5_0")
        if model_id != "whisper.cpp-large-v3-turbo-q5_0":
            raise ValueError(f"STT_MODEL_ID không khớp backend whisper.cpp: {model_id}")
        requested_device = (
            device or os.getenv("WHISPER_CPP_DEVICE", "auto")
        ).strip().lower()
        if requested_device not in {"auto", "metal", "cpu"}:
            raise ValueError("WHISPER_CPP_DEVICE must be auto, metal, or cpu")
        executable_setting = os.getenv("WHISPER_CPP_BIN", "whisper-cli")
        executable = shutil.which(executable_setting)
        if executable is None and Path(executable_setting).is_file():
            executable = str(Path(executable_setting).expanduser().resolve())
        if executable is None:
            raise FileNotFoundError("WHISPER_CPP_BIN was not found on PATH")
        threads = int(os.getenv("WHISPER_CPP_THREADS", "4"))
        timeout_seconds = float(os.getenv("WHISPER_CPP_TIMEOUT_SECONDS", "1800"))
        if threads < 1 or timeout_seconds <= 0:
            raise ValueError("Invalid whisper.cpp thread/timeout configuration")
        predictor = WhisperCppPredictor(
            model_path=weights_path,
            executable=executable,
            device=requested_device,
            threads=threads,
            timeout_seconds=timeout_seconds,
            cpu_fallback=_env_bool("WHISPER_CPP_CPU_FALLBACK", True),
        )
        runtime_device = requested_device
        return LocalModelAdapter(
            model_name=model_id,
            loader_fn=lambda: predictor,
            version="large-v3-turbo-q5_0",
            device=runtime_device,
        )

    if backend not in {"faster-whisper", "faster_whisper", "ct2"}:
        raise ValueError(f"STT_BACKEND không được hỗ trợ: {backend}")
    if not weights_path.is_dir():
        raise FileNotFoundError(f"Không tìm thấy thư mục model Faster-Whisper: {weights_path}")
    if not (weights_path / "model.bin").is_file():
        raise FileNotFoundError(f"Thiếu model.bin trong: {weights_path}")

    supported_models = {
        "faster-whisper-small": "1.0",
        "faster-whisper-medium": "1.0",
        "faster-whisper-large-v3": "3.0",
    }
    configured_model_id = os.getenv("STT_MODEL_ID")
    model_id = configured_model_id or weights_path.name
    if model_id not in supported_models:
        raise ValueError(f"Model STT không được hỗ trợ bởi Faster-Whisper: {model_id}")
    if weights_path.name in supported_models and weights_path.name != model_id:
        raise ValueError(
            f"STT_MODEL_ID={model_id} không khớp với thư mục model {weights_path.name}"
        )

    requested_device = (device or os.getenv("WHISPER_DEVICE", "auto")).strip().lower()
    if requested_device == "auto":
        runtime_device = "cuda" if torch.cuda.is_available() else "cpu"
    elif requested_device == "mps":
        # CTranslate2 does not support Apple MPS; report actual CPU inference.
        runtime_device = "cpu"
    elif requested_device in {"cpu", "cuda"}:
        runtime_device = requested_device
    else:
        raise ValueError(f"WHISPER_DEVICE không hợp lệ: {requested_device}")

    def loader(selected_device: str) -> WhisperPredictor:
        ct2_device = "cpu" if selected_device == "mps" else selected_device
        runtime_compute_type = (
            compute_type or os.getenv("WHISPER_COMPUTE_TYPE")
            or ("int8_float16" if ct2_device == "cuda" else "int8")
        )
        logger.info(
            "STT inference backend=faster-whisper model=%s device=%s compute_type=%s",
            model_id, ct2_device, runtime_compute_type,
        )
        model = WhisperModel(
            str(weights_path), device=ct2_device,
            compute_type=runtime_compute_type, local_files_only=True,
        )
        return WhisperPredictor(model)

    return LocalModelAdapter(
        model_name=model_id,
        loader_fn=loader,
        version=supported_models[model_id],
        device=runtime_device,
    )
