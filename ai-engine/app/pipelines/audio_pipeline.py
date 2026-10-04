import os
import time
import wave
import json
import math
import struct
import logging
import hashlib
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional, Set, Callable, Tuple

from app.pipelines.contracts import (
    AudioStage,
    PipelineStatus,
    PipelineJobContext,
    AudioMetadata,
    SpeakerSegment,
    StageResult,
    AudioPipelineOutput,
)
from app.pipelines.exceptions import (
    AudioPipelineError,
    InputValidationError,
    FFmpegStageError,
    WebRTCStageError,
    PyannoteStageError,
    OutputGenerationError,
)

logger = logging.getLogger("smartrec.audio_pipeline")

SUPPORTED_EXTENSIONS: Set[str] = {
    # Audio extensions
    ".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg", ".wma",
    # Video extensions (chứa luồng audio cần tách)
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv"
}


# ======================================================================
# ARTIFACT INTEGRITY, CONTENT CHECKSUM & ATOMIC MANIFEST HELPERS
# ======================================================================

def compute_file_sha256(file_path: Path, chunk_size: int = 65536) -> str:
    """Tính mã băm SHA-256 trực tiếp từ nội dung tệp (chống giả mạo size/mtime)."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()


def compute_stage_fingerprint(
    input_content_hash: str,
    stage_name: str,
    stage_config: Dict[str, Any],
    pipeline_version: str = "1.0.0"
) -> str:
    """Tính fingerprint cache kết hợp input hash, tên stage, cấu hình và version."""
    config_json = json.dumps(stage_config, sort_keys=True)
    raw = f"{pipeline_version}:{stage_name}:{input_content_hash}:{config_json}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _save_artifact_meta(
    wav_path: Path,
    fingerprint: str,
    duration: float,
    stage_name: str,
    config: Dict[str, Any]
) -> None:
    """
    Ghi companion manifest metadata theo cơ chế Atomic Write:
    Ghi ra file tạm thời rồi thay thế bằng os.replace để chống file hỏng dở dang.
    """
    meta_path = wav_path.with_suffix(wav_path.suffix + ".meta.json")
    tmp_meta_path = meta_path.with_name(f"{meta_path.name}.tmp.{os.getpid()}")

    artifact_size = wav_path.stat().st_size
    artifact_checksum = compute_file_sha256(wav_path)

    payload = {
        "fingerprint": fingerprint,
        "stage": stage_name,
        "sample_rate": 16000,
        "channels": 1,
        "sample_width": 2,
        "duration": duration,
        "size_bytes": artifact_size,
        "checksum_sha256": artifact_checksum,
        "config": config,
    }

    try:
        tmp_meta_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp_meta_path.replace(meta_path)
    except Exception:
        if tmp_meta_path.exists():
            try:
                tmp_meta_path.unlink()
            except Exception:
                pass
        raise


def _validate_wav_artifact(wav_path: Path, expected_fingerprint: str) -> Optional[AudioMetadata]:
    """
    Xác thực tính toàn vẹn và hợp lệ tuyệt đối của artifact trước khi tái sử dụng:
    1. File WAV tồn tại và dung lượng > 44 bytes.
    2. Companion manifest tồn tại và fingerprint khớp hoàn toàn.
    3. Size thực tế khớp với size_bytes trong manifest.
    4. Checksum SHA-256 của nội dung file WAV khớp với checksum_sha256 trong manifest.
    5. Header WAV đọc được: đúng chuẩn 16kHz, mono, 16-bit PCM, duration > 0.
    """
    if not wav_path.exists() or wav_path.stat().st_size <= 44:
        return None

    meta_path = wav_path.with_suffix(wav_path.suffix + ".meta.json")
    if not meta_path.exists():
        return None

    try:
        meta_data = json.loads(meta_path.read_text(encoding="utf-8"))
        if meta_data.get("fingerprint") != expected_fingerprint:
            return None

        expected_size = meta_data.get("size_bytes")
        actual_size = wav_path.stat().st_size
        if expected_size is None or actual_size != expected_size:
            return None

        expected_checksum = meta_data.get("checksum_sha256")
        if not expected_checksum:
            return None
        actual_checksum = compute_file_sha256(wav_path)
        if actual_checksum != expected_checksum:
            return None

        with wave.open(str(wav_path), "rb") as wf:
            channels = wf.getnchannels()
            width = wf.getsampwidth()
            rate = wf.getframerate()
            frames = wf.getnframes()
            if channels != 1 or width != 2 or rate != 16000 or frames <= 0:
                return None
            duration = round(frames / float(rate), 3)
            if duration <= 0.0:
                return None
            return AudioMetadata(sample_rate=rate, channels=channels, duration=duration, format="wav")
    except Exception:
        return None


# ======================================================================
# STAGE 1: INPUT VALIDATION
# ======================================================================

class InputValidationStage:
    """Xác thực tính hợp lệ của Job context và file media đầu vào."""

    def __init__(self, supported_extensions: Set[str] = SUPPORTED_EXTENSIONS):
        self.supported_extensions = supported_extensions

    def process(self, context: PipelineJobContext) -> StageResult:
        start_time = time.time()
        job_id = context.job_id

        if not job_id or not isinstance(job_id, str):
            raise InputValidationError("job_id không được để trống và phải là chuỗi.", job_id=str(job_id))

        if not context.media_id or not isinstance(context.media_id, str):
            raise InputValidationError("media_id không hợp lệ.", job_id=job_id)

        if not context.file_location:
            raise InputValidationError("file_location không được để trống.", job_id=job_id)

        file_path = Path(context.file_location)

        if not file_path.exists():
            raise InputValidationError(f"File đầu vào không tồn tại tại: {file_path}", job_id=job_id)

        if not file_path.is_file():
            raise InputValidationError(f"Đường dẫn file_location không phải là file hợp lệ: {file_path}", job_id=job_id)

        if not os.access(file_path, os.R_OK):
            raise InputValidationError(f"Không có quyền đọc file đầu vào: {file_path}", job_id=job_id)

        file_size = file_path.stat().st_size
        if file_size == 0:
            raise InputValidationError(f"File đầu vào rỗng (0 bytes): {file_path}", job_id=job_id)

        suffix = file_path.suffix.lower()
        if suffix not in self.supported_extensions:
            raise InputValidationError(
                f"Định dạng file '{suffix}' không nằm trong danh sách hỗ trợ của Audio Pipeline.",
                job_id=job_id
            )

        elapsed = time.time() - start_time
        return StageResult(
            stage=AudioStage.INPUT_VALIDATION,
            success=True,
            output_path=str(file_path.resolve()),
            duration_seconds=elapsed,
            metadata={
                "file_size_bytes": file_size,
                "file_format": suffix,
                "validated_path": str(file_path.resolve()),
            }
        )


# ======================================================================
# STAGE 2: FFMPEG NORMALIZATION (16 kHz Mono WAV)
# ======================================================================

class FFmpegStage:
    """Tách audio từ video và chuẩn hóa về chuẩn 16 kHz Mono 16-bit PCM WAV."""

    def __init__(self, ffmpeg_bin: str = "ffmpeg", timeout_seconds: float = 300.0):
        self.ffmpeg_bin = ffmpeg_bin
        self.timeout_seconds = timeout_seconds

    def get_config(self) -> Dict[str, Any]:
        return {
            "sample_rate": 16000,
            "channels": 1,
            "acodec": "pcm_s16le",
            "format": "wav"
        }

    def _extract_wav_duration(self, wav_path: Path, job_id: str) -> float:
        if not wav_path.exists() or wav_path.stat().st_size <= 44:
            raise FFmpegStageError(f"File output FFmpeg không tồn tại hoặc kích thước không hợp lệ: {wav_path}", job_id=job_id)

        try:
            with wave.open(str(wav_path), "rb") as wf:
                channels = wf.getnchannels()
                width = wf.getsampwidth()
                rate = wf.getframerate()
                frames = wf.getnframes()

                if rate != 16000 or channels != 1 or width != 2:
                    raise FFmpegStageError(
                        f"FFmpeg output WAV không đúng chuẩn (yêu cầu 16kHz Mono 16-bit; thực tế: {rate}Hz, {channels}ch, {width*8}bit).",
                        job_id=job_id
                    )
                if frames <= 0 or rate <= 0:
                    raise FFmpegStageError(f"FFmpeg output WAV rỗng hoặc không có frame âm thanh (frames={frames}).", job_id=job_id)

                duration = round(frames / float(rate), 3)
                if duration <= 0.0:
                    raise FFmpegStageError(f"FFmpeg output WAV có duration không hợp lệ: {duration}s.", job_id=job_id)
                return duration
        except wave.Error as we:
            raise FFmpegStageError(f"Lỗi parse header WAV từ output FFmpeg: {str(we)}", job_id=job_id) from we
        except FFmpegStageError:
            raise
        except Exception as e:
            raise FFmpegStageError(f"Lỗi đọc file WAV từ output FFmpeg: {str(e)}", job_id=job_id) from e

    def process(
        self,
        context: PipelineJobContext,
        input_media_path: str,
        fingerprint: Optional[str] = None
    ) -> StageResult:
        start_time = time.time()
        job_id = context.job_id
        src_path = Path(input_media_path)

        if not src_path.exists():
            raise FFmpegStageError(f"Input media không tồn tại cho FFmpeg: {src_path}", job_id=job_id)

        output_wav = context.work_dir / f"ffmpeg_{job_id}.wav"

        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-i", str(src_path),
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            str(output_wav)
        ]

        try:
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=self.timeout_seconds
            )
        except subprocess.TimeoutExpired as te:
            raise FFmpegStageError(
                f"Quá trình FFmpeg vượt thời gian tối đa ({self.timeout_seconds}s): {te}",
                job_id=job_id
            ) from te
        except FileNotFoundError as fnf:
            raise FFmpegStageError(
                f"Không tìm thấy binary '{self.ffmpeg_bin}' trên hệ thống: {fnf}",
                job_id=job_id
            ) from fnf
        except Exception as e:
            raise FFmpegStageError(f"Lỗi không xác định khi thực thi FFmpeg: {str(e)}", job_id=job_id) from e

        if proc.returncode != 0:
            error_tail = "\n".join(proc.stderr.strip().splitlines()[-5:])
            raise FFmpegStageError(
                f"FFmpeg kết thúc với mã lỗi {proc.returncode}. Chi tiết: {error_tail}",
                job_id=job_id
            )

        duration = self._extract_wav_duration(output_wav, job_id=job_id)

        if fingerprint:
            try:
                _save_artifact_meta(
                    wav_path=output_wav,
                    fingerprint=fingerprint,
                    duration=duration,
                    stage_name=AudioStage.FFMPEG.value,
                    config=self.get_config()
                )
            except Exception as me:
                raise FFmpegStageError(
                    f"Không thể ghi manifest metadata cho artifact FFmpeg: {str(me)}",
                    job_id=job_id
                ) from me

        elapsed = time.time() - start_time
        return StageResult(
            stage=AudioStage.FFMPEG,
            success=True,
            output_path=str(output_wav.resolve()),
            duration_seconds=elapsed,
            metadata={
                "sample_rate": 16000,
                "channels": 1,
                "duration": duration,
                "format": "wav",
                "fingerprint": fingerprint,
            }
        )


# ======================================================================
# STAGE 3: WEBRTC AUDIO ENHANCEMENT (NOISE SUPPRESSION / APM)
# ======================================================================

class AudioANSServiceAdapter:
    """
    Adapter tương thích chuyển đổi giữa AudioANSService sẵn có của hệ thống
    và contract processor_fn(frame_bytes) -> frame_bytes của pipeline.
    Hỗ trợ chia nhỏ các frame 20ms/30ms thành sub-frame 10ms (320 bytes) chuẩn WebRTC APM.
    """
    def __init__(self, service: Any, suppression_level: int = 2):
        self.service = service
        self.base_frame_duration_ms: int = int(
            getattr(service, "FRAME_DURATION_MS", getattr(service, "frame_duration_ms", 10))
        )
        self.base_frame_bytes = int(16000 * (self.base_frame_duration_ms / 1000.0) * 2)
        self.processor = None

        if hasattr(service, "_create_processor") and callable(service._create_processor):
            try:
                self.processor = service._create_processor(suppression_level)
            except TypeError:
                try:
                    self.processor = service._create_processor()
                except Exception:
                    self.processor = None
            except Exception:
                self.processor = None
        elif hasattr(service, "processor"):
            self.processor = getattr(service, "processor")

    def _call_raw_process(self, chunk_10ms: bytes) -> bytes:
        if hasattr(self.service, "_process_frame") and callable(self.service._process_frame):
            if self.processor is not None:
                try:
                    return self.service._process_frame(self.processor, chunk_10ms)
                except TypeError:
                    pass
            try:
                return self.service._process_frame(chunk_10ms)
            except TypeError:
                pass

        for method_name in ("process_frame", "process", "suppress_noise", "denoise"):
            method = getattr(self.service, method_name, None)
            if callable(method):
                return method(chunk_10ms)

        if callable(self.service):
            return self.service(chunk_10ms)

        raise TypeError(f"AudioANSService kiểu '{type(self.service).__name__}' không cung cấp method xử lý frame hợp lệ.")

    def process_frame(self, frame_bytes: bytes) -> bytes:
        sub_len = self.base_frame_bytes
        if len(frame_bytes) == sub_len:
            return self._call_raw_process(frame_bytes)

        processed_chunks = []
        for offset in range(0, len(frame_bytes), sub_len):
            chunk = frame_bytes[offset:offset + sub_len]
            if len(chunk) < sub_len:
                chunk += b"\x00" * (sub_len - len(chunk))
            processed_chunks.append(self._call_raw_process(chunk))

        return b"".join(processed_chunks)[:len(frame_bytes)]


class WebRTCStage:
    """
    Xử lý giảm nhiễu âm thanh (Noise Suppression / APM).
    Kết nối chuẩn xác với AudioANSService sẵn có hoặc nhận processor_fn được inject.
    Bảo toàn số mẫu chính xác (cắt padding) và hỗ trợ processor_cache_key ổn định.
    """

    def __init__(
        self,
        frame_duration_ms: Optional[int] = None,
        processor_fn: Optional[Callable[[bytes], bytes]] = None,
        processor_cache_key: Optional[str] = None
    ):
        if frame_duration_ms is not None and frame_duration_ms not in (10, 20, 30):
            raise ValueError("frame_duration_ms phải là 10, 20 hoặc 30 ms.")
        self._explicit_frame_duration_ms = frame_duration_ms
        self.processor_fn = processor_fn
        self.processor_cache_key = processor_cache_key

    def get_effective_frame_duration_ms(self) -> int:
        """Nguồn chân lý duy nhất cho frame duration."""
        if self._explicit_frame_duration_ms is not None:
            return self._explicit_frame_duration_ms
        if self.processor_fn is not None:
            return 30
        return 10

    def get_config(self) -> Dict[str, Any]:
        cfg: Dict[str, Any] = {
            "frame_duration_ms": self.get_effective_frame_duration_ms(),
            "backend": "custom_injected" if self.processor_fn is not None else "AudioANSService",
        }
        if self.processor_fn is not None:
            if self.processor_cache_key:
                cfg["processor_cache_key"] = self.processor_cache_key
            else:
                cfg["non_cacheable"] = True
        else:
            cfg["processor_cache_key"] = "AudioANSService:v1:level-2"
        return cfg

    def _resolve_backend(self, job_id: str) -> Tuple[Callable[[bytes], bytes], int]:
        dur = self.get_effective_frame_duration_ms()

        if self.processor_fn is not None:
            return self.processor_fn, dur

        try:
            from app.services.audio_ans import AudioANSService
            if AudioANSService is None:
                raise ImportError("AudioANSService is None in module")
        except (ImportError, AttributeError) as ie:
            raise WebRTCStageError(
                f"Không thể tìm thấy AudioANSService tại app.services.audio_ans: {str(ie)}",
                job_id=job_id
            ) from ie

        try:
            service = AudioANSService()
            adapter = AudioANSServiceAdapter(service)
            return adapter.process_frame, dur
        except Exception as e:
            raise WebRTCStageError(
                f"Lỗi khởi tạo hoặc thích ứng AudioANSService backend: {str(e)}",
                job_id=job_id
            ) from e

    def process(
        self,
        context: PipelineJobContext,
        input_wav_path: str,
        fingerprint: Optional[str] = None
    ) -> StageResult:
        start_time = time.time()
        job_id = context.job_id
        src_path = Path(input_wav_path)

        if not src_path.exists() or src_path.stat().st_size <= 44:
            raise WebRTCStageError(f"Input audio không tồn tại hoặc không hợp lệ cho WebRTC: {src_path}", job_id=job_id)

        clean_wav = context.work_dir / f"clean_{job_id}.wav"

        try:
            with wave.open(str(src_path), "rb") as wf_in:
                channels = wf_in.getnchannels()
                sample_width = wf_in.getsampwidth()
                sample_rate = wf_in.getframerate()
                n_frames = wf_in.getnframes()

                if channels != 1 or sample_rate != 16000 or sample_width != 2:
                    raise WebRTCStageError(
                        f"WebRTC yêu cầu audio chuẩn 16kHz Mono 16-bit PCM. "
                        f"Thực tế nhận được: {sample_rate}Hz, {channels}ch, {sample_width*8}bit.",
                        job_id=job_id
                    )
                if n_frames <= 0:
                    raise WebRTCStageError("Audio đầu vào cho WebRTC rỗng (0 frames).", job_id=job_id)

                raw_bytes = wf_in.readframes(n_frames)
        except WebRTCStageError:
            raise
        except Exception as e:
            raise WebRTCStageError(f"Lỗi khi đọc file WAV đầu vào WebRTC: {str(e)}", job_id=job_id) from e

        total_len = len(raw_bytes)
        # PCM 16-bit Mono bắt buộc số byte phải là số chẵn
        if total_len % 2 != 0:
            raise WebRTCStageError("PCM đầu vào có số byte không hợp lệ (không chia hết cho 2 bytes/sample).", job_id=job_id)

        processor, frame_dur = self._resolve_backend(job_id)

        samples_per_frame = int(sample_rate * (frame_dur / 1000.0))
        bytes_per_frame = samples_per_frame * 2
        processed_frames = []

        for offset in range(0, total_len, bytes_per_frame):
            frame_data = raw_bytes[offset:offset + bytes_per_frame]
            if len(frame_data) < bytes_per_frame:
                frame_data += b"\x00" * (bytes_per_frame - len(frame_data))

            try:
                proc_frame = processor(frame_data)
            except Exception as pe:
                raise WebRTCStageError(f"WebRTC frame processor ném lỗi khi xử lý: {str(pe)}", job_id=job_id) from pe

            if not isinstance(proc_frame, (bytes, bytearray)) or len(proc_frame) != bytes_per_frame:
                raise WebRTCStageError(
                    f"WebRTC processor trả về dữ liệu khung sai kích thước (yêu cầu {bytes_per_frame} bytes).",
                    job_id=job_id
                )
            processed_frames.append(bytes(proc_frame))

        enhanced_bytes = b"".join(processed_frames)
        # Cắt chính xác về total_len ban đầu để bảo toàn số mẫu âm thanh
        enhanced_bytes = enhanced_bytes[:total_len]

        try:
            with wave.open(str(clean_wav), "wb") as wf_out:
                wf_out.setnchannels(1)
                wf_out.setsampwidth(2)
                wf_out.setframerate(16000)
                wf_out.writeframes(enhanced_bytes)
        except Exception as e:
            raise WebRTCStageError(f"Lỗi khi ghi file WAV sau WebRTC: {str(e)}", job_id=job_id) from e

        duration = round(len(enhanced_bytes) / (16000 * 2), 3)

        if fingerprint:
            try:
                _save_artifact_meta(
                    wav_path=clean_wav,
                    fingerprint=fingerprint,
                    duration=duration,
                    stage_name=AudioStage.WEBRTC.value,
                    config=self.get_config()
                )
            except Exception as me:
                raise WebRTCStageError(
                    f"Không thể ghi manifest metadata cho artifact WebRTC: {str(me)}",
                    job_id=job_id
                ) from me

        elapsed = time.time() - start_time
        return StageResult(
            stage=AudioStage.WEBRTC,
            success=True,
            output_path=str(clean_wav.resolve()),
            duration_seconds=elapsed,
            metadata={
                "frame_duration_ms": frame_dur,
                "clean_audio_path": str(clean_wav.resolve()),
                "duration": duration,
                "fingerprint": fingerprint,
            }
        )


# ======================================================================
# STAGE 4: PYANNOTE SPEAKER DIARIZATION
# ======================================================================

class PyannoteStage:
    """
    Phân tích âm thanh và phân đoạn người nói qua pyannote-audio.
    Tuyệt đối không sử dụng fallback giả lập kết quả khi runtime gặp sự cố (Fail-Stop).
    """

    def __init__(self, diarizer_fn: Optional[Callable[[str], List[Dict[str, Any]]]] = None):
        self._diarizer_fn = diarizer_fn or self._default_diarizer

    def _default_diarizer(self, audio_path: str) -> List[Dict[str, Any]]:
        from app.diarization.runtime import DiarizationRuntime
        runtime = DiarizationRuntime()
        return runtime.diarize(audio_path)

    def process(self, context: PipelineJobContext, clean_audio_path: str) -> StageResult:
        start_time = time.time()
        job_id = context.job_id
        src_path = Path(clean_audio_path)

        if not src_path.exists():
            raise PyannoteStageError(f"Audio sạch không tồn tại cho pyannote stage: {src_path}", job_id=job_id)

        try:
            raw_segments = self._diarizer_fn(str(src_path))
        except PyannoteStageError:
            raise
        except Exception as e:
            raise PyannoteStageError(f"Lỗi khi thực thi mô hình pyannote-audio: {str(e)}", job_id=job_id) from e

        if not isinstance(raw_segments, list):
            raise PyannoteStageError("Kết quả từ pyannote không phải là danh sách segments.", job_id=job_id)

        parsed_segments: List[SpeakerSegment] = []
        for idx, item in enumerate(raw_segments):
            if not isinstance(item, dict):
                raise PyannoteStageError(f"Segment tại vị trí {idx} không phải là dictionary.", job_id=job_id)

            speaker = item.get("speaker")
            start = item.get("start")
            end = item.get("end")

            if speaker is None or start is None or end is None:
                raise PyannoteStageError(
                    f"Segment tại vị trí {idx} thiếu trường bắt buộc (speaker/start/end): {item}",
                    job_id=job_id
                )

            try:
                start_f = float(start)
                end_f = float(end)
            except (ValueError, TypeError) as ve:
                raise PyannoteStageError(f"Timestamp tại segment {idx} không thể chuyển đổi sang float.", job_id=job_id) from ve

            if math.isnan(start_f) or math.isnan(end_f) or math.isinf(start_f) or math.isinf(end_f):
                raise PyannoteStageError(f"Timestamp tại segment {idx} không hợp lệ (NaN hoặc Inf).", job_id=job_id)

            if end_f < start_f:
                raise PyannoteStageError(
                    f"Timestamp bất hợp lý (end < start): start={start_f}, end={end_f} tại segment {idx}",
                    job_id=job_id
                )

            parsed_segments.append(SpeakerSegment(speaker=str(speaker), start=start_f, end=end_f))

        elapsed = time.time() - start_time
        return StageResult(
            stage=AudioStage.PYANNOTE,
            success=True,
            duration_seconds=elapsed,
            metadata={
                "segment_count": len(parsed_segments),
                "segments": [s.to_dict() for s in parsed_segments],
            }
        )


# ======================================================================
# AUDIO PIPELINE ORCHESTRATOR
# ======================================================================

class AudioPipelineOrchestrator:
    """
    Bộ điều phối trung tâm của SmartRec Audio Pipeline.
    Xác lập chuỗi liên kết artifact chặt chẽ (Artifact Lineage Chaining):
    Input Media SHA-256 -> FFmpeg Artifact -> FFmpeg SHA-256 -> WebRTC Artifact.
    """

    def __init__(
        self,
        input_stage: Optional[InputValidationStage] = None,
        ffmpeg_stage: Optional[FFmpegStage] = None,
        webrtc_stage: Optional[WebRTCStage] = None,
        pyannote_stage: Optional[PyannoteStage] = None,
    ):
        self.input_stage = input_stage or InputValidationStage()
        self.ffmpeg_stage = ffmpeg_stage or FFmpegStage()
        self.webrtc_stage = webrtc_stage or WebRTCStage()
        self.pyannote_stage = pyannote_stage or PyannoteStage()

    def _validate_start_stage(self, start_from_stage: Any, job_id: str) -> Optional[AudioStage]:
        if start_from_stage is None:
            return None
        if isinstance(start_from_stage, AudioStage):
            return start_from_stage
        if isinstance(start_from_stage, str):
            try:
                return AudioStage(start_from_stage)
            except ValueError:
                pass
        valid_values = [s.value for s in AudioStage]
        raise AudioPipelineError(
            f"Giá trị start_from_stage không hợp lệ: '{start_from_stage}'. Hỗ trợ: {valid_values}",
            stage="ORCHESTRATOR",
            job_id=job_id
        )

    def _check_stage_result(
        self,
        result: StageResult,
        expected_stage: AudioStage,
        job_id: str,
        exc_cls: type
    ) -> None:
        if not isinstance(result, StageResult):
            raise exc_cls(f"Stage {expected_stage.value} không trả về StageResult hợp lệ.", job_id=job_id)

        if result.stage != expected_stage:
            actual_name = result.stage.value if hasattr(result.stage, "value") else str(result.stage)
            raise exc_cls(
                f"Sai định danh stage: mong đợi '{expected_stage.value}', nhưng nhận được '{actual_name}'.",
                job_id=job_id
            )

        if not result.success:
            err_msg = result.error_message or f"Stage {expected_stage.value} báo thất bại (success=False)."
            raise exc_cls(err_msg, job_id=job_id)

        if expected_stage in (AudioStage.INPUT_VALIDATION, AudioStage.FFMPEG, AudioStage.WEBRTC):
            if not result.output_path or not Path(result.output_path).exists():
                raise exc_cls(f"Stage {expected_stage.value} báo thành công nhưng không có output_path hợp lệ.", job_id=job_id)

    def run(
        self,
        context: PipelineJobContext,
        start_from_stage: Optional[AudioStage] = None
    ) -> AudioPipelineOutput:
        job_id = context.job_id
        target_stage = self._validate_start_stage(start_from_stage, job_id=job_id)
        logger.info(f"[{job_id}] Bắt đầu Audio Pipeline Orchestrator (start_stage={target_stage})...")
        stage_times: Dict[str, float] = {}

        # ----------------------------------------------------
        # STAGE 1: INPUT VALIDATION
        # ----------------------------------------------------
        logger.info(f"[{job_id}] -> Khởi chạy STAGE 1: INPUT_VALIDATION")
        val_result = self.input_stage.process(context)
        self._check_stage_result(val_result, AudioStage.INPUT_VALIDATION, job_id, InputValidationError)
        stage_times[AudioStage.INPUT_VALIDATION.value] = val_result.duration_seconds
        validated_input_path = Path(val_result.output_path)

        input_content_hash = compute_file_sha256(validated_input_path)

        # ----------------------------------------------------
        # STAGE 2: FFMPEG (16 kHz Mono)
        # ----------------------------------------------------
        ffmpeg_config = self.ffmpeg_stage.get_config()
        ffmpeg_fingerprint = compute_stage_fingerprint(
            input_content_hash=input_content_hash,
            stage_name=AudioStage.FFMPEG.value,
            stage_config=ffmpeg_config
        )

        ffmpeg_artifact = context.work_dir / f"ffmpeg_{job_id}.wav"
        existing_ffmpeg_meta = _validate_wav_artifact(ffmpeg_artifact, ffmpeg_fingerprint)
        can_skip_ffmpeg = (
            target_stage in (AudioStage.WEBRTC, AudioStage.PYANNOTE, AudioStage.OUTPUT_GENERATION)
            and existing_ffmpeg_meta is not None
        )

        if can_skip_ffmpeg:
            logger.info(f"[{job_id}] -> Bỏ qua STAGE 2 (FFmpeg artifact hợp lệ & fingerprint khớp: {ffmpeg_artifact})")
            ffmpeg_path = str(ffmpeg_artifact.resolve())
            stage_times[AudioStage.FFMPEG.value] = 0.0
            audio_meta = existing_ffmpeg_meta
        else:
            logger.info(f"[{job_id}] -> Khởi chạy STAGE 2: FFMPEG")
            ffmpeg_result = self.ffmpeg_stage.process(context, str(validated_input_path), fingerprint=ffmpeg_fingerprint)
            self._check_stage_result(ffmpeg_result, AudioStage.FFMPEG, job_id, FFmpegStageError)
            stage_times[AudioStage.FFMPEG.value] = ffmpeg_result.duration_seconds
            ffmpeg_path = ffmpeg_result.output_path
            audio_meta = AudioMetadata(
                sample_rate=ffmpeg_result.metadata.get("sample_rate", 16000),
                channels=ffmpeg_result.metadata.get("channels", 1),
                duration=ffmpeg_result.metadata.get("duration", 0.0),
                format="wav"
            )

        # ----------------------------------------------------
        # STAGE 3: WEBRTC ENHANCEMENT
        # ----------------------------------------------------
        ffmpeg_content_hash = compute_file_sha256(Path(ffmpeg_path))

        webrtc_config = self.webrtc_stage.get_config()
        is_webrtc_cacheable = not webrtc_config.get("non_cacheable", False)

        if is_webrtc_cacheable:
            webrtc_fingerprint = compute_stage_fingerprint(
                input_content_hash=ffmpeg_content_hash,
                stage_name=AudioStage.WEBRTC.value,
                stage_config=webrtc_config
            )
        else:
            webrtc_fingerprint = None

        clean_artifact = context.work_dir / f"clean_{job_id}.wav"
        existing_clean_meta = (
            _validate_wav_artifact(clean_artifact, webrtc_fingerprint)
            if is_webrtc_cacheable and webrtc_fingerprint is not None
            else None
        )

        can_skip_webrtc = (
            target_stage in (AudioStage.PYANNOTE, AudioStage.OUTPUT_GENERATION)
            and is_webrtc_cacheable
            and existing_clean_meta is not None
        )

        if can_skip_webrtc:
            logger.info(f"[{job_id}] -> Bỏ qua STAGE 3 (WebRTC artifact hợp lệ & fingerprint khớp: {clean_artifact})")
            clean_path = str(clean_artifact.resolve())
            stage_times[AudioStage.WEBRTC.value] = 0.0
        else:
            logger.info(f"[{job_id}] -> Khởi chạy STAGE 3: WEBRTC")
            webrtc_result = self.webrtc_stage.process(context, ffmpeg_path, fingerprint=webrtc_fingerprint)
            self._check_stage_result(webrtc_result, AudioStage.WEBRTC, job_id, WebRTCStageError)
            stage_times[AudioStage.WEBRTC.value] = webrtc_result.duration_seconds
            clean_path = webrtc_result.output_path

        # ----------------------------------------------------
        # STAGE 4: PYANNOTE DIARIZATION
        # ----------------------------------------------------
        logger.info(f"[{job_id}] -> Khởi chạy STAGE 4: PYANNOTE")
        pyannote_result = self.pyannote_stage.process(context, clean_path)
        self._check_stage_result(pyannote_result, AudioStage.PYANNOTE, job_id, PyannoteStageError)
        stage_times[AudioStage.PYANNOTE.value] = pyannote_result.duration_seconds
        segments = pyannote_result.metadata.get("segments", [])

        # ----------------------------------------------------
        # STAGE 5: OUTPUT GENERATION
        # ----------------------------------------------------
        logger.info(f"[{job_id}] -> Khởi chạy STAGE 5: OUTPUT_GENERATION")
        out_start = time.time()
        try:
            if not isinstance(segments, list):
                raise ValueError("Danh sách segments không phải kiểu list.")
            for idx, seg in enumerate(segments):
                if not isinstance(seg, dict):
                    raise ValueError(f"Segment #{idx} không phải dictionary.")
                if "speaker" not in seg or "start" not in seg or "end" not in seg:
                    raise ValueError(f"Segment #{idx} thiếu trường speaker/start/end.")
                s = float(seg["start"])
                e = float(seg["end"])
                if math.isnan(s) or math.isnan(e) or math.isinf(s) or math.isinf(e):
                    raise ValueError(f"Segment #{idx} chứa timestamp không hợp lệ (NaN/Inf).")
                if e < s:
                    raise ValueError(f"Segment #{idx} có end < start: {s} > {e}")

            if audio_meta.duration <= 0.0:
                raise ValueError(f"Metadata duration không hợp lệ: {audio_meta.duration}s")

            out_elapsed = time.time() - out_start
            stage_times[AudioStage.OUTPUT_GENERATION.value] = round(out_elapsed, 4)

            output = AudioPipelineOutput(
                job_id=job_id,
                media_id=context.media_id,
                status=PipelineStatus.SUCCESS.value,
                audio_metadata={
                    "sample_rate": audio_meta.sample_rate,
                    "channels": audio_meta.channels,
                    "duration": audio_meta.duration,
                    "format": audio_meta.format,
                    "ffmpeg_artifact": ffmpeg_path,
                    "clean_artifact": clean_path,
                },
                segments=segments,
                stage_execution_times=stage_times,
                error=None
            )
            logger.info(f"[{job_id}] Audio Pipeline hoàn tất thành công! ({len(segments)} segments)")
            return output
        except AudioPipelineError:
            raise
        except Exception as exc:
            raise OutputGenerationError(
                f"Lỗi khi xây dựng hoặc serialize AudioPipelineOutput: {str(exc)}",
                job_id=job_id
            ) from exc
