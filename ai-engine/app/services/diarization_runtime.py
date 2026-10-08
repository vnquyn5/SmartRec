import logging
import os
import threading
import time
import wave
from pathlib import Path
from typing import Optional, Union, Any, Dict, List

import numpy as np
import torch
from torch.torch_version import TorchVersion
from pyannote.audio.core.task import (
    Specifications,
    Problem,
    Resolution,
)
logger = logging.getLogger("smartrec.diarization_runtime")


def _read_torch_thread_overrides(
    environ: Optional[Dict[str, str]] = None,
) -> tuple[Optional[str], Optional[str]]:
    env = os.environ if environ is None else environ
    intraop = env.get("PYTORCH_NUM_THREADS")
    interop = env.get("PYTORCH_INTEROP_THREADS")

    def configured(value: Optional[str]) -> Optional[str]:
        return value.strip() or None if value is not None else None

    return configured(intraop), configured(interop)


_torch_threads_configured = False
_torch_threads_lock = threading.Lock()


def _configure_torch_threads_once() -> None:
    global _torch_threads_configured
    with _torch_threads_lock:
        if _torch_threads_configured:
            return
        intraop_threads, interop_threads = _read_torch_thread_overrides()
        if intraop_threads is not None:
            torch.set_num_threads(int(intraop_threads))
        if interop_threads is not None:
            torch.set_num_interop_threads(int(interop_threads))
        _torch_threads_configured = True
        logger.info(
            "PyTorch runtime threads: num_threads=%s num_interop_threads=%s",
            torch.get_num_threads(),
            torch.get_num_interop_threads(),
        )


_configure_torch_threads_once()

from pyannote.audio import Pipeline
from pyannote.core import Annotation


def _audio_duration_and_label(audio_input: Union[str, Path, Dict[str, Any]]) -> tuple[Optional[float], str]:
    if isinstance(audio_input, (str, Path)):
        path = Path(audio_input)
        try:
            with wave.open(str(path), "rb") as audio_file:
                rate = audio_file.getframerate()
                duration = audio_file.getnframes() / float(rate) if rate > 0 else None
            return duration, path.name
        except (OSError, wave.Error, EOFError, ZeroDivisionError):
            return None, path.name
    return None, "audio-input"


def _get_field_value(obj: Any, field_name: str, default: Optional[Any] = None) -> Optional[Any]:
    """
    Trích xuất giá trị trường an toàn từ dict hoặc object/Pydantic model.
    Phân biệt rõ ràng giá trị 0.0 (hợp lệ) và None, chống lỗi biểu thức 'or' khi gặp 0.0.
    """
    if isinstance(obj, dict):
        if field_name in obj:
            return obj[field_name]
    elif hasattr(obj, field_name):
        val = getattr(obj, field_name)
        if val is not None:
            return val
    return default


class DiarizationRuntimeError(Exception):
    """Lỗi chung cho quá trình khởi tạo và thực thi Diarization Pipeline."""
    pass


class DiarizationTokenMissingError(DiarizationRuntimeError):
    """Ngoại lệ khi không tìm thấy Hugging Face token hợp lệ."""
    pass


class DiarizationAccessDeniedError(DiarizationRuntimeError):
    """Ngoại lệ khi Hugging Face token bị từ chối quyền truy cập pretrained model."""
    pass


class DiarizationInferenceError(DiarizationRuntimeError):
    """Ngoại lệ khi quá trình inference gặp lỗi hoặc trả về output không đúng contract."""
    pass


class DiarizationRuntimeManager:
    """
    Quản lý vòng đời mô hình pyannote/speaker-diarization-3.1 theo mẫu Singleton.
    Đảm bảo:
    - Thread-safe khởi tạo qua Double-Checked Locking.
    - Thread-safe inference và device-fallback qua _inference_lock.
    - Chuẩn hóa nghiêm ngặt contract trả về kiểu Annotation.
    - Trích xuất Speaker Embeddings 256 chiều an toàn với mọi mốc thời gian (kể cả 0.0s).
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super(DiarizationRuntimeManager, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(
        self,
        model_name: str = "pyannote/speaker-diarization-3.1",
        hf_token: Optional[str] = None,
        prefer_device: Optional[str] = None
    ):
        if self._initialized:
            return

        with self._lock:
            if self._initialized:
                return

            self.model_name = model_name
            self.hf_token = hf_token or os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
            self._pipeline: Optional[Pipeline] = None
            self._init_lock = threading.Lock()
            self._inference_lock = threading.RLock()
            self.device = self._resolve_target_device(prefer_device)
            self._initialized = True
            logger.info(f"Đã khởi tạo DiarizationRuntimeManager (mô hình: {self.model_name}, thiết bị: {self.device})")

    def _resolve_target_device(self, prefer_device: Optional[str] = None) -> str:
        """Xác định thiết bị tính toán tối ưu dựa trên phần cứng."""
        if prefer_device:
            return prefer_device

        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def load_pipeline(self) -> Pipeline:
        """
        Nạp pipeline vào bộ nhớ (Lazy Loading, Thread-safe qua Double-Checked Locking).
        """
        if self._pipeline is not None:
            return self._pipeline

        with self._init_lock:
            if self._pipeline is not None:
                return self._pipeline

            if not self.hf_token:
                logger.error("Không tìm thấy Hugging Face token (biến môi trường HF_TOKEN hoặc HUGGING_FACE_HUB_TOKEN)")
                raise DiarizationTokenMissingError(
                    "HF_TOKEN chưa được cấu hình. pyannote-audio yêu cầu token xác thực để nạp model gated."
                )

            logger.info(f"Đang tải pretrained pipeline '{self.model_name}' từ Hugging Face Hub...")
            try:
                with torch.serialization.safe_globals([
                    TorchVersion,
                    Specifications,
                    Problem,
                    Resolution,
                ]):
                    pipeline = Pipeline.from_pretrained(
                        self.model_name,
                        use_auth_token=self.hf_token,
                    )
            except Exception as e:
                err_msg = str(e).lower()
                if "401" in err_msg or "gated" in err_msg or "unauthorized" in err_msg or "access" in err_msg:
                    logger.error(f"Từ chối quyền truy cập pretrained model: {e}")
                    raise DiarizationAccessDeniedError(
                        f"Quyền truy cập model '{self.model_name}' bị từ chối. Vui lòng chấp thuận điều khoản tại Hugging Face: {e}"
                    ) from e
                logger.error(f"Không thể nạp pretrained pipeline: {e}")
                raise DiarizationRuntimeError(f"Lỗi nạp mô hình pyannote: {e}") from e

            if pipeline is None:
                raise DiarizationAccessDeniedError(
                    f"Không thể khởi tạo pipeline từ model '{self.model_name}'. Kiểm tra lại quyền sở hữu token."
                )

            try:
                target_dev = torch.device(self.device)
                pipeline.to(target_dev)
                logger.info(f"Đã đưa pipeline '{self.model_name}' lên thiết bị: {self.device}")
            except Exception as dev_err:
                logger.warning(
                    f"Không thể đưa pipeline lên thiết bị '{self.device}' ({dev_err}). Fallback về 'cpu'..."
                )
                self.device = "cpu"
                pipeline.to(torch.device("cpu"))

            self._pipeline = pipeline
            return self._pipeline

    def _normalize_annotation(self, raw_output: Any) -> Annotation:
        """
        Chuẩn hóa kết quả inference đảm bảo trả về đúng kiểu pyannote.core.Annotation.
        Hỗ trợ cả Annotation trực tiếp và đối tượng chứa thuộc tính speaker_diarization.
        """
        if isinstance(raw_output, Annotation):
            return raw_output
        if hasattr(raw_output, "speaker_diarization"):
            annot = getattr(raw_output, "speaker_diarization")
            if isinstance(annot, Annotation):
                return annot
        raise DiarizationInferenceError(
            f"Kết quả diarization không hợp lệ. Kỳ vọng kiểu 'pyannote.core.Annotation', nhưng nhận được '{type(raw_output).__name__}'."
        )

    def diarize(self, audio_input: Union[str, Path, Dict[str, Any]], **kwargs) -> Annotation:
        """
        Thực thi Speaker Diarization trên audio đầu vào.
        Thread-safe: Sử dụng _inference_lock bảo vệ model dùng chung khi fallback MPS -> CPU.
        """
        with self._inference_lock:
            pipeline = self.load_pipeline()
            audio_duration, file_label = _audio_duration_and_label(audio_input)
            started_at = time.perf_counter()
            succeeded = False
            logger.info(
                "PYANNOTE inference start: audio_duration=%s file=%s",
                f"{audio_duration:.2f}s" if audio_duration is not None else "unknown",
                file_label,
            )
            try:
                try:
                    raw_output = pipeline(audio_input, **kwargs)
                except Exception as inf_err:
                    if self.device != "mps":
                        raise DiarizationInferenceError(f"Diarization inference thất bại: {inf_err}") from inf_err
                    logger.warning(
                        f"Inference trên thiết bị 'mps' gặp lỗi ({inf_err}). Tự động fallback về 'cpu' và chạy lại..."
                    )
                    try:
                        self.device = "cpu"
                        pipeline.to(torch.device("cpu"))
                        raw_output = pipeline(audio_input, **kwargs)
                        logger.info("Chạy lại Diarization inference trên CPU thành công sau fallback!")
                    except Exception as cpu_err:
                        logger.error(f"Thực thi trên CPU cũng thất bại: {cpu_err}")
                        raise DiarizationInferenceError(
                            f"Diarization inference thất bại trên cả MPS và CPU: {cpu_err}"
                        ) from cpu_err
                annotation = self._normalize_annotation(raw_output)
                succeeded = True
                return annotation
            finally:
                elapsed = time.perf_counter() - started_at
                rtf = elapsed / audio_duration if audio_duration is not None and audio_duration > 0 else None
                logger.info(
                    "PYANNOTE inference %s: audio_duration=%s elapsed=%.2fs rtf=%s file=%s",
                    "done" if succeeded else "failed",
                    f"{audio_duration:.2f}s" if audio_duration is not None else "unknown",
                    elapsed,
                    f"{rtf:.2f}x" if rtf is not None else "n/a",
                    file_label,
                )

    def extract_speaker_embeddings(
        self,
        audio_path: Union[str, Path],
        speaker_segments: List[Any],
        max_duration_per_speaker: float = 30.0
    ) -> Dict[str, List[float]]:
        """
        Trích xuất vector đặc trưng âm học (Speaker Embeddings 256 chiều) cho từng speaker.
        Xử lý an toàn với mọi mốc thời gian (bao gồm start_seconds = 0.0s trên Pydantic models).
        Hỗ trợ cả đầu ra NumPy ndarray và PyTorch Tensor.
        """
        if not speaker_segments:
            return {}

        pipeline = self.load_pipeline()
        emb_model = getattr(pipeline, "_embedding", None)
        if emb_model is None:
            logger.warning("Pipeline không có mô hình _embedding. Bỏ qua trích xuất vector đặc trưng.")
            return {}

        audio_path_str = str(audio_path)
        if not os.path.exists(audio_path_str):
            logger.warning(f"File âm thanh không tồn tại để trích xuất embeddings: {audio_path_str}")
            return {}

        # Gom nhóm các segments theo speaker an toàn
        speaker_map: Dict[str, List[Any]] = {}
        for seg in speaker_segments:
            spk = _get_field_value(seg, "speaker") or _get_field_value(seg, "raw_speaker_id")
            if spk:
                speaker_map.setdefault(spk, []).append(seg)

        embeddings_result: Dict[str, List[float]] = {}

        try:
            with wave.open(audio_path_str, "rb") as wf:
                sr = wf.getframerate()
                sampwidth = wf.getsampwidth()
                n_channels = wf.getnchannels()
                total_frames = wf.getnframes()

                for speaker, segs in speaker_map.items():
                    # Lấy phân đoạn dài nhất của người nói để có vector đặc trưng tốt nhất
                    sorted_segs = sorted(
                        segs,
                        key=lambda s: _get_field_value(s, "duration_seconds", _get_field_value(s, "duration", 0.0)),
                        reverse=True
                    )
                    best_seg = sorted_segs[0]

                    # Đọc start_seconds và end_seconds tuyệt đối an toàn với 0.0s
                    start_sec = _get_field_value(best_seg, "start_seconds", _get_field_value(best_seg, "start", 0.0))
                    end_sec = _get_field_value(best_seg, "end_seconds", _get_field_value(best_seg, "end", 0.0))

                    start_frame = max(0, int(start_sec * sr))
                    end_frame = min(total_frames, int(end_sec * sr))
                    num_frames = end_frame - start_frame

                    if num_frames < sr * 0.2:  # Bỏ qua nếu quá ngắn (< 0.2s)
                        continue

                    wf.setpos(start_frame)
                    raw_data = wf.readframes(num_frames)

                    if sampwidth == 2:
                        audio_np = np.frombuffer(raw_data, dtype=np.int16).astype(np.float32) / 32768.0
                    else:
                        continue

                    if n_channels > 1:
                        audio_np = audio_np.reshape(-1, n_channels).mean(axis=1)

                    # Định dạng cho pyannote embedding: (batch, channel, samples) -> (1, 1, N)
                    waveform = torch.from_numpy(audio_np).unsqueeze(0).unsqueeze(0)

                    # Gọi model embedding và hỗ trợ cả Tensor lẫn ndarray
                    emb_output = emb_model(waveform)
                    if isinstance(emb_output, torch.Tensor):
                        emb_output = emb_output.detach().cpu().numpy()

                    if isinstance(emb_output, np.ndarray):
                        emb_vec = emb_output.flatten().tolist()
                        embeddings_result[speaker] = [round(float(x), 6) for x in emb_vec]

        except Exception as e:
            logger.error(f"Lỗi khi trích xuất speaker embeddings từ audio '{audio_path}': {e}")
            raise IOError(f"Lỗi đọc audio trích xuất embeddings: {e}") from e

        return embeddings_result

    def reset(self):
        """Giải phóng tài nguyên pipeline và bộ nhớ GPU."""
        with self._lock:
            with self._init_lock:
                if self._pipeline is not None:
                    del self._pipeline
                    self._pipeline = None
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                elif hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                    torch.mps.empty_cache()
                logger.info("Đã giải phóng tài nguyên Diarization pipeline.")


diarization_runtime = DiarizationRuntimeManager()
