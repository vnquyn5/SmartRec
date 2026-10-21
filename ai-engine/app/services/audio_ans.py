import os
import wave
import time
import math
import struct
import numpy as np
from typing import Dict, Any, Optional

try:
    import webrtc_noise_gain
except ImportError:
    webrtc_noise_gain = None


class AudioANSError(Exception):
    """Ngoại lệ cơ sở cho các lỗi xử lý trong module AudioANS."""
    pass


class InvalidAudioFormatError(AudioANSError):
    """Ngoại lệ khi định dạng audio đầu vào không đạt chuẩn 16kHz Mono PCM 16-bit."""
    pass


class AudioSignalLostError(AudioANSError):
    """Ngoại lệ khi tín hiệu âm thanh bị mất hoàn toàn sau khi lọc."""
    pass


class AudioANSService:
    """
    Dịch vụ Acoustic Noise Suppression (ANS) sử dụng lõi WebRTC AudioProcessing.
    Chuyên dụng lọc tạp âm nền văn phòng (tiếng quạt, điều hòa, gõ phím, hum noise).
    """

    # Hằng số chuẩn hóa WebRTC APM
    SAMPLE_RATE = 16000          # 16kHz
    CHANNELS = 1                 # Mono
    BYTES_PER_SAMPLE = 2         # PCM 16-bit = 2 bytes
    FRAME_DURATION_MS = 10       # Frame chuẩn 10ms
    SAMPLES_PER_FRAME = int(SAMPLE_RATE * (FRAME_DURATION_MS / 1000.0))  # 160 samples
    FRAME_SIZE_BYTES = SAMPLES_PER_FRAME * BYTES_PER_SAMPLE              # 320 bytes

    def __init__(self, default_suppression_level: int = 3, auto_gain_dbfs: int = 0):
        """
        Khởi tạo WebRTC AudioProcessor.
        :param default_suppression_level: Mức độ lọc nhiễu (0: Mild, 1: Medium, 2: High, 3: Aggressive).
        :param auto_gain_dbfs: Mức khuếch đại gain tự động (0: tắt AGC).
        """
        if webrtc_noise_gain is None:
            raise AudioANSError("Thư viện 'webrtc-noise-gain' chưa được cài đặt trong môi trường.")

        if default_suppression_level not in (0, 1, 2, 3):
            raise ValueError("default_suppression_level phải nằm trong khoảng [0, 3].")

        self.default_suppression_level = default_suppression_level
        self.auto_gain_dbfs = auto_gain_dbfs

    def _create_processor(self, suppression_level: int) -> Any:
        """Tạo instance WebRTC AudioProcessor với tham số tương ứng."""
        return webrtc_noise_gain.AudioProcessor(
            self.auto_gain_dbfs,
            suppression_level
        )

    def _process_frame(self, processor: Any, frame_bytes: bytes) -> bytes:
        """Xử lý 1 frame 10ms (320 bytes) qua WebRTC APM Process10ms."""
        result = processor.Process10ms(frame_bytes)
        return result.audio if hasattr(result, "audio") else result

    @staticmethod
    def _calculate_rms(audio_bytes: bytes) -> float:
        """Tính toán RMS an toàn bằng NumPy, tránh tạo tuple hàng chục triệu integers."""
        if not audio_bytes:
            return 0.0
        arr = np.frombuffer(audio_bytes, dtype=np.int16)
        if len(arr) == 0:
            return 0.0
        sum_sq = float(np.sum(arr.astype(np.float64) ** 2))
        return math.sqrt(sum_sq / len(arr))

    def apply_noise_suppression(
        self,
        input_path: str,
        output_path: Optional[str] = None,
        suppression_level: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Thực hiện lọc tạp âm WebRTC ANS trên tệp âm thanh đầu vào theo cơ chế Stream/Block.
        Tránh nạp toàn bộ file vào RAM để ngăn chặn OOM trên các file dài (45-90 phút).
        """
        start_time = time.time()
        input_path = os.path.abspath(input_path)
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"File nguồn không tồn tại: {input_path}")

        level = self.default_suppression_level if suppression_level is None else suppression_level
        if level not in (0, 1, 2, 3):
            raise ValueError("suppression_level phải nằm trong khoảng [0, 3].")

        # 1. Đọc header và xác thực tiêu chuẩn định dạng (chỉ đọc metadata, không nạp audio bytes)
        try:
            with wave.open(input_path, "rb") as in_wf:
                channels = in_wf.getnchannels()
                sample_rate = in_wf.getframerate()
                sample_width = in_wf.getsampwidth()
                total_frames = in_wf.getnframes()
        except Exception as e:
            raise InvalidAudioFormatError(f"Không thể đọc cấu trúc tệp WAV: {str(e)}")

        if total_frames == 0:
            raise InvalidAudioFormatError("File âm thanh đầu vào rỗng (0 frames).")

        if sample_rate != self.SAMPLE_RATE:
            raise InvalidAudioFormatError(
                f"Sample rate {sample_rate}Hz không đúng chuẩn pipeline ({self.SAMPLE_RATE}Hz)."
            )
        if channels != self.CHANNELS:
            raise InvalidAudioFormatError(
                f"Số kênh âm thanh ({channels}) không phải Mono ({self.CHANNELS})."
            )
        if sample_width != self.BYTES_PER_SAMPLE:
            raise InvalidAudioFormatError(
                f"Độ sâu bit ({sample_width * 8}-bit) không phải chuẩn PCM 16-bit."
            )

        # 2. Thiết lập đường dẫn file đầu ra
        if not output_path:
            base_dir = os.path.dirname(input_path)
            base_name = os.path.splitext(os.path.basename(input_path))[0]
            output_path = os.path.join(base_dir, f"{base_name}_ans.wav")
        output_path = os.path.abspath(output_path)

        if output_path == input_path:
            raise AudioANSError("output_path không được trùng với input_path.")

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        processor = self._create_processor(suppression_level=level)

        # Khối đọc 1 giây = 16000 frame = 32000 bytes PCM 16-bit
        BLOCK_FRAMES = 16000
        input_sum_sq = 0.0
        output_sum_sq = 0.0
        bytes_processed = 0

        # 3. Stream đọc - lọc - ghi theo từng block trực tiếp ra ổ đĩa
        try:
            with wave.open(input_path, "rb") as in_wf, wave.open(output_path, "wb") as out_wf:
                out_wf.setnchannels(self.CHANNELS)
                out_wf.setsampwidth(self.BYTES_PER_SAMPLE)
                out_wf.setframerate(self.SAMPLE_RATE)

                remaining_frames = total_frames
                while remaining_frames > 0:
                    frames_to_read = min(BLOCK_FRAMES, remaining_frames)
                    raw_chunk = in_wf.readframes(frames_to_read)
                    if not raw_chunk:
                        break

                    remaining_frames -= frames_to_read

                    # Tích lũy RMS đầu vào siêu tốc qua NumPy int16
                    in_np = np.frombuffer(raw_chunk, dtype=np.int16)
                    input_sum_sq += float(np.sum(in_np.astype(np.float64) ** 2))

                    cleaned_chunk = bytearray()
                    # Chia thành các frame 10ms (320 bytes) để WebRTC APM xử lý
                    for offset in range(0, len(raw_chunk), self.FRAME_SIZE_BYTES):
                        frame = raw_chunk[offset:offset + self.FRAME_SIZE_BYTES]
                        if len(frame) < self.FRAME_SIZE_BYTES:
                            # Frame cuối cùng bị thiếu được zero-pad khớp 320 bytes rồi cắt về đúng kích thước
                            pad_len = self.FRAME_SIZE_BYTES - len(frame)
                            padded_frame = frame + (b"\x00" * pad_len)
                            cleaned_frame = self._process_frame(processor, padded_frame)
                            cleaned_chunk.extend(cleaned_frame[:len(frame)])
                        else:
                            cleaned_chunk.extend(self._process_frame(processor, frame))

                    # Tích lũy RMS đầu ra qua NumPy
                    out_np = np.frombuffer(cleaned_chunk, dtype=np.int16)
                    output_sum_sq += float(np.sum(out_np.astype(np.float64) ** 2))

                    # Ghi ngay ra file đích, giải phóng buffer
                    out_wf.writeframes(cleaned_chunk)

                    bytes_processed += len(raw_chunk)
                    if bytes_processed % 320000 == 0:
                        time.sleep(0.001)  # Nhường GIL để duy trì heartbeat worker

        except Exception as e:
            if os.path.exists(output_path):
                os.remove(output_path)
            raise AudioANSError(f"Lỗi khi xử lý stream ANS: {str(e)}")

        # 4. Kiểm định chất lượng (Zero Sample Drift & Signal Loss)
        with wave.open(output_path, "rb") as check_wf:
            out_frames = check_wf.getnframes()
            output_duration = out_frames / float(self.SAMPLE_RATE)

        if out_frames != total_frames:
            raise AudioANSError(
                f"Lỗi bảo toàn timeline (ANS-06): Input ({total_frames} samples) != Output ({out_frames} samples)."
            )

        input_rms = math.sqrt(input_sum_sq / total_frames) if total_frames > 0 else 0.0
        output_rms = math.sqrt(output_sum_sq / total_frames) if total_frames > 0 else 0.0

        if input_rms > 50.0 and output_rms < 1.0:
            raise AudioSignalLostError("Cảnh báo ANS-03: Tín hiệu giọng nói bị triệt tiêu hoàn toàn!")

        noise_reduction_db = 0.0
        if input_rms > 0 and output_rms > 0:
            noise_reduction_db = max(0.0, 20 * math.log10(input_rms / output_rms))

        return {
            "status": "SUCCESS",
            "message": "Đã khử tạp âm nền môi trường thành công.",
            "output_path": output_path,
            "output_file": output_path,
            "sample_rate": self.SAMPLE_RATE,
            "channels": self.CHANNELS,
            "noise_reduction_db": round(float(noise_reduction_db), 2),
            "input_rms": round(float(input_rms), 2),
            "output_rms": round(float(output_rms), 2),
            "processing_time_seconds": round(time.time() - start_time, 3),
            "suppression_level": level,
            "duration_seconds": round(output_duration, 3)
        }
