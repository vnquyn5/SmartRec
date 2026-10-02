import os
import wave
import time
import math
import struct
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
    def _calculate_rms(pcm_data: bytes) -> float:
        """Tính toán năng lượng hiệu dụng (RMS) của dữ liệu âm thanh PCM 16-bit."""
        count = len(pcm_data) // 2
        if count == 0:
            return 0.0
        format_str = f"<{count}h"
        samples = struct.unpack(format_str, pcm_data)
        sum_squares = sum(s * s for s in samples)
        return math.sqrt(sum_squares / count)

    def apply_noise_suppression(
        self,
        input_path: str,
        output_path: Optional[str] = None,
        suppression_level: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Thực hiện lọc tạp âm WebRTC ANS trên tệp âm thanh đầu vào.
        
        Quy trình:
        1. Kiểm tra tồn tại và xác thực định dạng (16kHz, Mono, 16-bit).
        2. Cắt thành các frame 10ms (320 bytes).
        3. Áp dụng WebRTC ANS trên từng frame.
        4. Bảo toàn timeline tuyệt đối qua zero-padding và unpadding.
        5. Ghi tệp WAV đầu ra và kiểm định chất lượng tín hiệu.
        """
        input_path = os.path.abspath(input_path)
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"File nguồn không tồn tại: {input_path}")

        level = self.default_suppression_level if suppression_level is None else suppression_level
        if level not in (0, 1, 2, 3):
            raise ValueError("suppression_level phải nằm trong khoảng [0, 3].")

        # 1. Đọc và xác thực cấu trúc WAV bằng module wave tiêu chuẩn
        try:
            with wave.open(input_path, "rb") as wf:
                channels = wf.getnchannels()
                sample_rate = wf.getframerate()
                sample_width = wf.getsampwidth()
                total_frames = wf.getnframes()
                raw_audio_bytes = wf.readframes(total_frames)
        except Exception as e:
            raise InvalidAudioFormatError(f"Không thể đọc cấu trúc tệp WAV: {str(e)}")

        # Kiểm tra tiêu chuẩn khắt khe của pipeline
        if sample_rate != self.SAMPLE_RATE:
            raise InvalidAudioFormatError(
                f"Sample rate {sample_rate}Hz không đúng chuẩn pipeline ({self.SAMPLE_RATE}Hz). "
                "Cần chuẩn hóa qua Task 2.8 trước khi đưa vào ANS."
            )
        if channels != self.CHANNELS:
            raise InvalidAudioFormatError(
                f"Số kênh âm thanh ({channels}) không phải Mono ({self.CHANNELS})."
            )
        if sample_width != self.BYTES_PER_SAMPLE:
            raise InvalidAudioFormatError(
                f"Độ sâu bit ({sample_width * 8}-bit) không phải chuẩn PCM 16-bit."
            )

        total_bytes = len(raw_audio_bytes)
        input_duration = total_frames / float(sample_rate)

        # Tính năng lượng gốc
        input_rms = self._calculate_rms(raw_audio_bytes)

        # Thiết lập đường dẫn output mặc định nếu không truyền
        if not output_path:
            base_dir = os.path.dirname(input_path)
            base_name = os.path.splitext(os.path.basename(input_path))[0]
            output_path = os.path.join(base_dir, f"{base_name}_ans.wav")
        output_path = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # 2. Xử lý zero-padding để chia vừa vặn các frame 320 bytes (ANS-06)
        remainder = total_bytes % self.FRAME_SIZE_BYTES
        padding_length = 0
        padded_bytes = raw_audio_bytes
        if remainder > 0:
            padding_length = self.FRAME_SIZE_BYTES - remainder
            padded_bytes += b"\x00" * padding_length

        # 3. Chạy qua bộ xử lý WebRTC ANS theo từng frame 10ms
        processor = self._create_processor(suppression_level=level)
        processed_chunks = []
        start_time = time.time()

        for offset in range(0, len(padded_bytes), self.FRAME_SIZE_BYTES):
            frame = padded_bytes[offset:offset + self.FRAME_SIZE_BYTES]
            cleaned_frame = self._process_frame(processor, frame)
            processed_chunks.append(cleaned_frame)

        elapsed_time = time.time() - start_time

        # 4. Ghép frame và cắt bỏ phần padding dư để khớp chính xác timeline gốc
        combined_cleaned_bytes = b"".join(processed_chunks)
        if padding_length > 0:
            final_audio_bytes = combined_cleaned_bytes[:-padding_length]
        else:
            final_audio_bytes = combined_cleaned_bytes

        # 5. Ghi dữ liệu sạch ra tệp WAV đầu ra
        try:
            with wave.open(output_path, "wb") as out_wf:
                out_wf.setnchannels(self.CHANNELS)
                out_wf.setsampwidth(self.BYTES_PER_SAMPLE)
                out_wf.setframerate(self.SAMPLE_RATE)
                out_wf.writeframes(final_audio_bytes)
        except Exception as e:
            if os.path.exists(output_path):
                os.remove(output_path)
            raise AudioANSError(f"Lỗi khi ghi tệp WAV đầu ra: {str(e)}")

        # 6. Kiểm định chất lượng đầu ra (Acceptance Criteria ANS-01 -> ANS-07)
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            if os.path.exists(output_path):
                os.remove(output_path)
            raise AudioANSError(f"File output rỗng hoặc không tồn tại: {output_path}")

        # Kiểm tra tính toàn vẹn duration
        with wave.open(output_path, "rb") as check_wf:
            out_frames = check_wf.getnframes()
            output_duration = out_frames / float(self.SAMPLE_RATE)

        # Chặn nếu duration bị lệch quá 1 mili-giây
        if abs(output_duration - input_duration) > 0.001:
            raise AudioANSError(
                f"Lỗi bảo toàn thời lượng: Duration gốc {input_duration:.3f}s != "
                f"Duration sau ANS {output_duration:.3f}s"
            )

        output_rms = self._calculate_rms(final_audio_bytes)

        # Nếu file gốc có âm thanh (RMS > 50) nhưng file sau ANS hoàn toàn im lặng (RMS < 1.0) -> Cảnh báo mất tín hiệu
        if input_rms > 50.0 and output_rms < 1.0:
            raise AudioSignalLostError("Cảnh báo: Tín hiệu âm thanh bị triệt tiêu hoàn toàn sau khi lọc!")

        # Tính tỷ lệ giảm ồn (Noise Reduction Ratio theo dB tương đối)
        db_reduction = 0.0
        if input_rms > 0 and output_rms > 0:
            db_reduction = round(20 * math.log10(input_rms / output_rms), 2)

        return {
            "status": "SUCCESS",
            "input_file": input_path,
            "output_file": output_path,
            "sample_rate": self.SAMPLE_RATE,
            "channels": self.CHANNELS,
            "suppression_level": level,
            "duration_seconds": round(output_duration, 3),
            "input_rms": round(input_rms, 2),
            "output_rms": round(output_rms, 2),
            "noise_reduction_db": db_reduction,
            "processing_time_seconds": round(elapsed_time, 3)
        }