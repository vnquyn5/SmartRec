import os
import wave
import time
import math
import shutil
import logging
from typing import Dict, Any, Optional, Tuple
import numpy as np

logger = logging.getLogger(__name__)


class AudioAECError(Exception):
    """Ngoại lệ cơ sở cho các lỗi xử lý trong module AudioAEC."""
    pass


class InvalidAudioFormatError(AudioAECError):
    """Ngoại lệ khi định dạng audio đầu vào không đạt chuẩn 16kHz Mono PCM 16-bit."""
    pass


class AudioSignalLostError(AudioAECError):
    """Ngoại lệ khi tín hiệu âm thanh bị mất hoàn toàn sau khi khử tiếng vang."""
    pass


class AudioAECService:
    """
    Dịch vụ Acoustic Echo Cancellation (AEC) loại bỏ tiếng vọng phản hồi giữa loa và micro.
    Tuân thủ chuẩn phân rã frame 10ms của WebRTC APM kết hợp bộ lọc thích nghi NLMS,
    ước lượng độ trễ bằng FFT và bộ bảo vệ giọng nói Geigel Double-Talk Detector.
    """

    SAMPLE_RATE = 16000          # Chuẩn 16kHz
    CHANNELS = 1                 # Mono
    BYTES_PER_SAMPLE = 2         # PCM 16-bit (2 bytes/sample)
    FRAME_DURATION_MS = 10       # Frame chuẩn WebRTC 10ms
    SAMPLES_PER_FRAME = int(SAMPLE_RATE * (FRAME_DURATION_MS / 1000.0))  # 160 samples
    FRAME_SIZE_BYTES = SAMPLES_PER_FRAME * BYTES_PER_SAMPLE              # 320 bytes

    def __init__(self, filter_length: int = 512, step_size: float = 0.25):
        self.filter_length = filter_length
        self.step_size = step_size
        self.last_filter_weights = None
        self.last_double_talk_count = 0

    def _validate_wav(self, file_path: str, label: str = "Audio") -> Tuple[int, int, int, bytes]:
        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"{label} không tồn tại: {file_path}")

        try:
            with wave.open(file_path, "rb") as wf:
                channels = wf.getnchannels()
                sample_rate = wf.getframerate()
                sample_width = wf.getsampwidth()
                total_frames = wf.getnframes()
                raw_bytes = wf.readframes(total_frames)
        except Exception as e:
            raise InvalidAudioFormatError(f"Không thể đọc cấu trúc tệp WAV {label}: {str(e)}")

        if total_frames == 0:
            raise InvalidAudioFormatError(f"{label} không có dữ liệu âm thanh (0 frames).")

        if sample_rate != self.SAMPLE_RATE:
            raise InvalidAudioFormatError(
                f"{label} có sample rate {sample_rate}Hz không đúng chuẩn ({self.SAMPLE_RATE}Hz)."
            )
        if channels != self.CHANNELS:
            raise InvalidAudioFormatError(
                f"{label} có số kênh ({channels}) không phải Mono ({self.CHANNELS})."
            )
        if sample_width != self.BYTES_PER_SAMPLE:
            raise InvalidAudioFormatError(
                f"{label} có độ sâu bit ({sample_width * 8}-bit) không phải chuẩn PCM 16-bit."
            )

        return channels, sample_rate, total_frames, raw_bytes

    @staticmethod
    def _calculate_rms(signal: np.ndarray) -> float:
        if len(signal) == 0:
            return 0.0
        return float(np.sqrt(np.mean(signal.astype(np.float64) ** 2)))

    def _estimate_bulk_delay(self, capture: np.ndarray, reference: np.ndarray, max_delay_samples: int = 4800) -> int:
        """
        Ước lượng độ trễ âm học bằng FFT Cross-Correlation (O(N log N)).
        """
        analysis_len = min(len(capture), len(reference), self.SAMPLE_RATE * 2)  # Cửa sổ 2s
        if analysis_len < 320:
            return 0

        cap_seg = capture[:analysis_len].astype(np.float32)
        ref_seg = reference[:analysis_len].astype(np.float32)

        cap_seg -= np.mean(cap_seg)
        ref_seg -= np.mean(ref_seg)

        # Tính tương quan chéo qua miền tần số bằng FFT
        n_fft = 1 << ((len(cap_seg) + len(ref_seg) - 1).bit_length())
        fft_cap = np.fft.rfft(cap_seg, n_fft)
        fft_ref = np.fft.rfft(ref_seg, n_fft)
        cross_corr = np.fft.irfft(fft_cap * np.conj(fft_ref))

        # Giới hạn tìm kiếm trong khoảng [0, max_delay_samples] (tối đa 300ms)
        search_window = cross_corr[:max_delay_samples]
        lag = int(np.argmax(search_window))
        return max(0, min(lag, max_delay_samples))

    def _process_nlms_echo_cancellation(
        self,
        capture_sig: np.ndarray,
        reference_sig: np.ndarray
    ) -> Tuple[np.ndarray, float]:
        """
        Lõi xử lý NLMS kèm Geigel DTD và Warm-up phase loại bỏ Cold-start Deadlock.
        """
        delay = self._estimate_bulk_delay(capture_sig, reference_sig)
        if delay > 0:
            aligned_ref = np.pad(reference_sig, (delay, 0), mode="constant")[:len(capture_sig)]
        else:
            aligned_ref = reference_sig[:len(capture_sig)]

        if len(aligned_ref) < len(capture_sig):
            aligned_ref = np.pad(aligned_ref, (0, len(capture_sig) - len(aligned_ref)), mode="constant")

        d = capture_sig.astype(np.float32) / 32768.0
        x = aligned_ref.astype(np.float32) / 32768.0

        n_samples = len(d)
        w = np.zeros(self.filter_length, dtype=np.float32)
        e = np.zeros(n_samples, dtype=np.float32)

        eps = 1e-6
        x_history = np.zeros(self.filter_length, dtype=np.float32)
        warmup_frames = 50  # 50 frame đầu (500ms) dành cho bộ lọc học ban đầu
        frame_idx = 0
        double_talk_count = 0

        for frame_start in range(0, n_samples, self.SAMPLES_PER_FRAME):
            frame_end = min(frame_start + self.SAMPLES_PER_FRAME, n_samples)
            frame_idx += 1
            is_warmup = frame_idx <= warmup_frames

            # Phán quyết Geigel DTD cấp độ khung 10ms (Chuẩn WebRTC APM)
            frame_d_max = float(np.max(np.abs(d[frame_start:frame_end])))
            history_start = max(0, frame_start - self.filter_length)
            frame_x_max = float(np.max(np.abs(x[history_start:frame_end]))) + eps

            dtd_threshold = 1.5 if is_warmup else 1.4
            is_double_talk_frame = frame_d_max > (dtd_threshold * frame_x_max)

            for n in range(frame_start, frame_end):
                x_history[1:] = x_history[:-1]
                x_history[0] = x[n]

                echo_est = float(np.dot(w, x_history))
                error = d[n] - echo_est
                e[n] = error

                ref_energy = float(np.dot(x_history, x_history)) + eps

                # GEIGEL DTD: Đóng băng thích ứng toàn khung để bảo vệ giọng nói
                if is_double_talk_frame:
                    double_talk_count += 1
                elif ref_energy > 1e-4:
                    w += (self.step_size / ref_energy) * error * x_history

        # Lưu lại trọng số và số mẫu bị đóng băng để test kiểm chứng trực tiếp (White-box testing)
        self.last_filter_weights = w.copy()
        self.last_double_talk_count = double_talk_count

        cleaned_signal = np.clip(e * 32768.0, -32768, 32767).astype(np.int16)

        cap_rms = self._calculate_rms(capture_sig)
        clean_rms = self._calculate_rms(cleaned_signal)
        erle_db = 0.0
        if cap_rms > 0 and clean_rms > 0:
            erle_db = round(20 * math.log10(cap_rms / clean_rms), 2)

        return cleaned_signal, max(0.0, erle_db)

    def cancel_echo(
        self,
        capture_path: str,
        reference_path: Optional[str] = None,
        output_path: Optional[str] = None
    ) -> Dict[str, Any]:
        start_time = time.time()
        capture_path = os.path.abspath(capture_path)

        _, sample_rate, total_frames, capture_bytes = self._validate_wav(capture_path, label="Capture Audio")
        input_duration = total_frames / float(sample_rate)

        if not output_path:
            base_dir = os.path.dirname(capture_path)
            base_name = os.path.splitext(os.path.basename(capture_path))[0]
            output_path = os.path.join(base_dir, f"{base_name}_aec.wav")
        output_path = os.path.abspath(output_path)

        # H2: Chặn ghi đè file nguồn
        if os.path.abspath(capture_path) == output_path:
            raise AudioAECError("output_path không được trùng với capture_path (nguy cơ ghi đè dữ liệu gốc).")
        if reference_path and os.path.abspath(reference_path) == output_path:
            raise AudioAECError("output_path không được trùng với reference_path (nguy cơ ghi đè dữ liệu gốc).")

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        capture_sig = np.frombuffer(capture_bytes, dtype=np.int16)
        input_rms = self._calculate_rms(capture_sig)

        # AEC-07: Fallback an toàn khi thiếu Reference
        if not reference_path or not os.path.isfile(reference_path):
            logger.warning("AEC-07: Missing reference stream. Safe bypass activated.")
            shutil.copyfile(capture_path, output_path)
            return {
                "status": "BYPASS_NO_REFERENCE",
                "message": "Không có reference audio từ loa. Bỏ qua AEC an toàn theo điều kiện AEC-07.",
                "capture_file": capture_path,
                "reference_file": None,
                "output_path": output_path,          # H1: Khớp schema AudioAECResponse
                "output_file": output_path,          # Tương thích ngược
                "reference_provided": False,         # H1: Khớp schema AudioAECResponse
                "sample_rate": self.SAMPLE_RATE,
                "channels": self.CHANNELS,
                "duration_seconds": round(input_duration, 3),
                "erle_db": 0.0,
                "input_rms": round(input_rms, 2),
                "output_rms": round(input_rms, 2),
                "processing_time_seconds": round(time.time() - start_time, 3)
            }

        try:
            _, _, _, ref_bytes = self._validate_wav(reference_path, label="Reference Audio")
            reference_sig = np.frombuffer(ref_bytes, dtype=np.int16)
        except InvalidAudioFormatError as e:
            logger.warning(f"AEC-07: Invalid reference format ({str(e)}). Safe fallback activated.")
            shutil.copyfile(capture_path, output_path)
            return {
                "status": "BYPASS_INVALID_REFERENCE",
                "message": f"Reference audio không hợp lệ. Fallback bảo vệ pipeline: {str(e)}",
                "capture_file": capture_path,
                "reference_file": reference_path,
                "output_path": output_path,          # H1: Khớp schema AudioAECResponse
                "output_file": output_path,          # Tương thích ngược
                "reference_provided": False,         # H1: Khớp schema AudioAECResponse
                "sample_rate": self.SAMPLE_RATE,
                "channels": self.CHANNELS,
                "duration_seconds": round(input_duration, 3),
                "erle_db": 0.0,
                "input_rms": round(input_rms, 2),
                "output_rms": round(input_rms, 2),
                "processing_time_seconds": round(time.time() - start_time, 3)
            }

        # Padding khớp frame 160 samples (AEC-06)
        remainder = len(capture_sig) % self.SAMPLES_PER_FRAME
        pad_len = 0
        padded_capture = capture_sig
        if remainder > 0:
            pad_len = self.SAMPLES_PER_FRAME - remainder
            padded_capture = np.pad(capture_sig, (0, pad_len), mode="constant")

        cleaned_padded, erle_db = self._process_nlms_echo_cancellation(padded_capture, reference_sig)

        if pad_len > 0:
            final_signal = cleaned_padded[:-pad_len]
        else:
            final_signal = cleaned_padded

        try:
            with wave.open(output_path, "wb") as out_wf:
                out_wf.setnchannels(self.CHANNELS)
                out_wf.setsampwidth(self.BYTES_PER_SAMPLE)
                out_wf.setframerate(self.SAMPLE_RATE)
                out_wf.writeframes(final_signal.tobytes())
        except Exception as e:
            if os.path.exists(output_path):
                os.remove(output_path)
            raise AudioAECError(f"Lỗi khi lưu file sau AEC: {str(e)}")

        output_rms = self._calculate_rms(final_signal)
        if input_rms > 50.0 and output_rms < 1.0:
            raise AudioSignalLostError("Cảnh báo AEC-03: Tín hiệu giọng nói bị triệt tiêu hoàn toàn!")

        # M4: Bảo toàn timeline chính xác tuyệt đối theo từng mẫu âm thanh (Zero Sample Drift)
        if len(final_signal) != len(capture_sig):
            raise AudioAECError(
                f"Lỗi bảo toàn timeline (AEC-06): Input ({len(capture_sig)} samples) != Output ({len(final_signal)} samples)."
            )

        output_duration = len(final_signal) / float(self.SAMPLE_RATE)
        return {
            "status": "SUCCESS",
            "message": "Đã triệt tiêu tiếng vang phản hồi từ microphone thành công.",
            "capture_file": capture_path,
            "reference_file": reference_path,
            "output_path": output_path,          # H1: Khớp schema AudioAECResponse
            "output_file": output_path,          # Tương thích ngược
            "reference_provided": True,          # H1: Khớp schema AudioAECResponse
            "sample_rate": self.SAMPLE_RATE,
            "channels": self.CHANNELS,
            "duration_seconds": round(output_duration, 3),
            "erle_db": erle_db,
            "input_rms": round(input_rms, 2),
            "output_rms": round(output_rms, 2),
            "processing_time_seconds": round(time.time() - start_time, 3)
        }
