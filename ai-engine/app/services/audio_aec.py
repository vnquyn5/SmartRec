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
    ước lượng độ trễ (Delay Estimation) và bộ bảo vệ giọng nói (Double-Talk Detector).
    """

    SAMPLE_RATE = 16000          # Chuẩn 16kHz
    CHANNELS = 1                 # Mono
    BYTES_PER_SAMPLE = 2         # PCM 16-bit (2 bytes/sample)
    FRAME_DURATION_MS = 10       # Frame chuẩn WebRTC 10ms
    SAMPLES_PER_FRAME = int(SAMPLE_RATE * (FRAME_DURATION_MS / 1000.0))  # 160 samples
    FRAME_SIZE_BYTES = SAMPLES_PER_FRAME * BYTES_PER_SAMPLE              # 320 bytes

    def __init__(self, filter_length: int = 512, step_size: float = 0.25):
        """
        Khởi tạo thông số bộ lọc AEC.
        :param filter_length: Số lượng trọng số bộ lọc (taps). 512 samples = 32ms đáp ứng xung phòng.
        :param step_size: Hệ số học thích nghi (mu) của thuật toán NLMS.
        """
        self.filter_length = filter_length
        self.step_size = step_size

    def _validate_wav(self, file_path: str, label: str = "Audio") -> Tuple[int, int, int, bytes]:
        """Kiểm tra tính hợp lệ của file WAV theo chuẩn pipeline (16kHz, Mono, 16-bit)."""
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
        """Tính giá trị RMS của mảng tín hiệu số."""
        if len(signal) == 0:
            return 0.0
        return float(np.sqrt(np.mean(signal.astype(np.float64) ** 2)))

    def _estimate_bulk_delay(self, capture: np.ndarray, reference: np.ndarray, max_delay_samples: int = 4800) -> int:
        """
        Ước lượng độ trễ âm học (Acoustic Propagation Delay) giữa loa và micro
        bằng tương quan chéo (Cross-Correlation) trên đoạn tín hiệu đầu.
        4800 samples tương đương tối đa 300ms trễ âm thanh trong phòng.
        """
        analysis_len = min(len(capture), len(reference), self.SAMPLE_RATE * 3)  # Tối đa 3 giây đầu
        if analysis_len < 320:
            return 0

        cap_seg = capture[:analysis_len].astype(np.float32)
        ref_seg = reference[:analysis_len].astype(np.float32)

        # Trừ giá trị trung bình DC offset
        cap_seg -= np.mean(cap_seg)
        ref_seg -= np.mean(ref_seg)

        corr = np.correlate(cap_seg, ref_seg, mode="full")
        lag = int(np.argmax(corr) - (len(ref_seg) - 1))
        return max(0, min(lag, max_delay_samples))

    def _process_nlms_echo_cancellation(
        self,
        capture_sig: np.ndarray,
        reference_sig: np.ndarray
    ) -> Tuple[np.ndarray, float]:
        """
        Lõi xử lý triệt tiêu tiếng vang theo từng frame 10ms sử dụng NLMS
        kết hợp Double-Talk Detector (DTD) để bảo vệ giọng nói người dùng.
        """
        # Căn chỉnh độ trễ âm học giữa luồng tham chiếu và capture
        delay = self._estimate_bulk_delay(capture_sig, reference_sig)
        if delay > 0:
            aligned_ref = np.pad(reference_sig, (delay, 0), mode="constant")[:len(capture_sig)]
        else:
            aligned_ref = reference_sig[:len(capture_sig)]

        # Nếu reference ngắn hơn capture, bù số 0 ở cuối
        if len(aligned_ref) < len(capture_sig):
            aligned_ref = np.pad(aligned_ref, (0, len(capture_sig) - len(aligned_ref)), mode="constant")

        # Chuẩn hóa về dải float [-1.0, 1.0] để tính toán ổn định số học
        d = capture_sig.astype(np.float32) / 32768.0
        x = aligned_ref.astype(np.float32) / 32768.0

        n_samples = len(d)
        w = np.zeros(self.filter_length, dtype=np.float32)
        e = np.zeros(n_samples, dtype=np.float32)

        eps = 1e-6
        x_history = np.zeros(self.filter_length, dtype=np.float32)

        # Xử lý theo từng frame 10ms (160 samples)
        for frame_start in range(0, n_samples, self.SAMPLES_PER_FRAME):
            frame_end = min(frame_start + self.SAMPLES_PER_FRAME, n_samples)
            
            for n in range(frame_start, frame_end):
                # Dịch cửa sổ lịch sử tín hiệu tham chiếu
                x_history[1:] = x_history[:-1]
                x_history[0] = x[n]

                # Ước lượng tiếng vọng phản hồi từ loa
                echo_est = float(np.dot(w, x_history))
                error = d[n] - echo_est
                e[n] = error

                # Double-Talk Detection (DTD - Geigel / Năng lượng tương đối):
                # Nếu tín hiệu capture lớn bất thường so với echo ước tính, người ở gần đang nói.
                # Đóng băng cập nhật trọng số để không triệt tiêu giọng nói thật (AEC-03).
                ref_energy = float(np.dot(x_history, x_history)) + eps
                near_power = error * error
                
                is_double_talk = near_power > (4.0 * (echo_est ** 2 + eps))
                if not is_double_talk and ref_energy > 1e-4:
                    norm_factor = ref_energy
                    w += (self.step_size / norm_factor) * error * x_history

        # Quy đổi tín hiệu sau lọc về chuẩn 16-bit PCM integer
        cleaned_signal = np.clip(e * 32768.0, -32768, 32767).astype(np.int16)

        # Tính Echo Return Loss Enhancement (ERLE - dB giảm tiếng vang)
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
        """
        Thực hiện triệt tiêu tiếng vang WebRTC AEC.
        
        Tuân thủ:
        - AEC-01, AEC-02, AEC-03: Khử tiếng vang khi có reference, bảo toàn giọng nói.
        - AEC-04, AEC-05, AEC-06: Chuẩn 16kHz Mono 16-bit, Zero Duration Drift.
        - AEC-07: Xử lý fallback an toàn khi thiếu reference signal.
        """
        start_time = time.time()
        capture_path = os.path.abspath(capture_path)

        # Xác thực file capture
        _, sample_rate, total_frames, capture_bytes = self._validate_wav(capture_path, label="Capture Audio")
        input_duration = total_frames / float(sample_rate)

        # Thiết lập đường dẫn output mặc định
        if not output_path:
            base_dir = os.path.dirname(capture_path)
            base_name = os.path.splitext(os.path.basename(capture_path))[0]
            output_path = os.path.join(base_dir, f"{base_name}_aec.wav")
        output_path = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        capture_sig = np.frombuffer(capture_bytes, dtype=np.int16)
        input_rms = self._calculate_rms(capture_sig)

        # ---------------------------------------------------------------------
        # KIỂM TRA ĐIỀU KIỆN AEC-07: Xử lý khi thiếu hoặc hỏng Reference Stream
        # ---------------------------------------------------------------------
        if not reference_path or not os.path.isfile(reference_path):
            logger.warning(
                "AEC-07 Contract Warning: Tệp reference không được cung cấp hoặc không tồn tại. "
                "Hệ thống kích hoạt chế độ Graceful Fallback (Bypass) để bảo toàn luồng âm thanh."
            )
            # Copy file capture sang output để bảo toàn tính nguyên vẹn
            shutil.copyfile(capture_path, output_path)
            return {
                "status": "BYPASS_NO_REFERENCE",
                "message": "Không có reference audio từ loa. Bỏ qua AEC an toàn theo điều kiện AEC-07.",
                "capture_file": capture_path,
                "reference_file": None,
                "output_file": output_path,
                "sample_rate": self.SAMPLE_RATE,
                "channels": self.CHANNELS,
                "duration_seconds": round(input_duration, 3),
                "erle_db": 0.0,
                "input_rms": round(input_rms, 2),
                "output_rms": round(input_rms, 2),
                "processing_time_seconds": round(time.time() - start_time, 3)
            }

        # Xác thực file reference nếu có
        try:
            _, _, _, ref_bytes = self._validate_wav(reference_path, label="Reference Audio")
            reference_sig = np.frombuffer(ref_bytes, dtype=np.int16)
        except InvalidAudioFormatError as e:
            logger.warning(
                f"AEC-07 Contract Warning: Định dạng Reference không hợp lệ ({str(e)}). "
                "Tự động fallback giữ nguyên âm thanh capture."
            )
            shutil.copyfile(capture_path, output_path)
            return {
                "status": "BYPASS_INVALID_REFERENCE",
                "message": f"Reference audio không hợp lệ. Fallback bảo vệ pipeline: {str(e)}",
                "capture_file": capture_path,
                "reference_file": reference_path,
                "output_file": output_path,
                "sample_rate": self.SAMPLE_RATE,
                "channels": self.CHANNELS,
                "duration_seconds": round(input_duration, 3),
                "erle_db": 0.0,
                "input_rms": round(input_rms, 2),
                "output_rms": round(input_rms, 2),
                "processing_time_seconds": round(time.time() - start_time, 3)
            }

        # ---------------------------------------------------------------------
        # TIẾN HÀNH KHỬ TIẾNG VANG (AEC ACTIVE)
        # ---------------------------------------------------------------------
        # Áp dụng padding để vừa khớp frame WebRTC 160 samples (AEC-06)
        remainder = len(capture_sig) % self.SAMPLES_PER_FRAME
        pad_len = 0
        padded_capture = capture_sig
        if remainder > 0:
            pad_len = self.SAMPLES_PER_FRAME - remainder
            padded_capture = np.pad(capture_sig, (0, pad_len), mode="constant")

        # Chạy lõi NLMS AEC
        cleaned_padded, erle_db = self._process_nlms_echo_cancellation(padded_capture, reference_sig)

        # Cắt bỏ phần padding để bảo toàn chính xác thời lượng (AEC-06)
        if pad_len > 0:
            final_signal = cleaned_padded[:-pad_len]
        else:
            final_signal = cleaned_padded

        # Ghi file WAV đầu ra
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

        # Kiểm định chất lượng (AEC-03, AEC-04, AEC-05, AEC-06)
        output_rms = self._calculate_rms(final_signal)
        if input_rms > 50.0 and output_rms < 1.0:
            raise AudioSignalLostError("Cảnh báo AEC-03: Tín hiệu giọng nói bị triệt tiêu hoàn toàn!")

        output_duration = len(final_signal) / float(self.SAMPLE_RATE)
        if abs(output_duration - input_duration) > 0.001:
            raise AudioAECError(
                f"Lỗi bảo toàn timeline (AEC-06): Input ({input_duration:.4f}s) != Output ({output_duration:.4f}s)"
            )

        return {
            "status": "SUCCESS",
            "message": "Đã triệt tiêu tiếng vang phản hồi từ microphone thành công.",
            "capture_file": capture_path,
            "reference_file": reference_path,
            "output_file": output_path,
            "sample_rate": self.SAMPLE_RATE,
            "channels": self.CHANNELS,
            "duration_seconds": round(output_duration, 3),
            "erle_db": erle_db,
            "input_rms": round(input_rms, 2),
            "output_rms": round(output_rms, 2),
            "processing_time_seconds": round(time.time() - start_time, 3)
        }