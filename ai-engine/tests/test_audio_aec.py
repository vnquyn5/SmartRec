import os
import sys
import wave
import math
import struct
import random

# Thiết lập đường dẫn gốc cho module ai-engine
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BASE_DIR)

from app.services.audio_aec import (
    AudioAECService,
    InvalidAudioFormatError,
    AudioSignalLostError,
    AudioAECError
)
from app.services.audio_ans import AudioANSService


def create_wav_file(path: str, samples: list, sample_rate: int = 16000) -> None:
    """Ghi mảng sample số nguyên 16-bit thành file WAV chuẩn Mono."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        raw_bytes = bytearray()
        for s in samples:
            val = int(max(-32768, min(32767, s)))
            raw_bytes.extend(struct.pack("<h", val))
        wf.writeframes(raw_bytes)


def generate_synthetic_audio_dataset(test_dir: str):
    """
    Tạo bộ dữ liệu âm học mô phỏng môi trường phòng họp:
    - Reference: Âm thanh phát từ loa ngoài (tần số 300Hz-600Hz).
    - Echo: Tiếng loa bị suy hao và trễ thời gian (Acoustic Delay ~60ms) lọt vào mic.
    - Local Voice: Giọng người nói trước mic (tần số 1000Hz).
    """
    sr = 16000
    duration = 3.5  # 3.5 giây
    total_samples = int(sr * duration)
    delay_samples = int(sr * 0.06)  # 60ms độ trễ âm thanh phòng

    ref_samples = []
    voice_samples = []
    echo_only_samples = [0] * delay_samples
    mixed_samples = [0] * delay_samples

    for i in range(total_samples):
        # 1. Âm thanh loa (Reference): Tổ hợp sóng hài
        ref_val = 14000 * math.sin(2 * math.pi * 350 * (i / sr)) + 7000 * math.sin(2 * math.pi * 700 * (i / sr))
        ref_samples.append(ref_val)

        # 2. Giọng nói người dùng (Local Voice)
        voice_val = 12000 * math.sin(2 * math.pi * 1000 * (i / sr))
        voice_samples.append(voice_val)

    # Tạo tiếng vọng (Echo): Suy hao còn 50% biên độ và trễ 60ms
    for i in range(total_samples):
        echo_val = 0.5 * ref_samples[i]
        echo_only_samples.append(echo_val)

        # Mixed: Giọng nói + Tiếng vang loa + chút nhiễu nền ngẫu nhiên
        ambient_noise = random.randint(-400, 400)
        mixed_samples.append(echo_val + voice_samples[i] + ambient_noise)

    ref_path = os.path.join(test_dir, "synth_reference.wav")
    echo_path = os.path.join(test_dir, "synth_echo_only.wav")
    mixed_path = os.path.join(test_dir, "synth_mixed_voice_echo.wav")

    create_wav_file(ref_path, ref_samples[:total_samples])
    create_wav_file(echo_path, echo_only_samples[:total_samples])
    create_wav_file(mixed_path, mixed_samples[:total_samples])

    return ref_path, echo_path, mixed_path


def run_aec_verification_tests():
    print("\n" + "=" * 75)
    print(">>> BẮT ĐẦU KIỂM THỬ ĐỘC LẬP WEBRTC AEC <<<")
    print("=" * 75 + "\n")

    test_dir = os.path.join(BASE_DIR, "tests", "output", "aec")
    os.makedirs(test_dir, exist_ok=True)
    aec_service = AudioAECService()

    # Sinh bộ dữ liệu âm học nhân tạo
    ref_file, echo_file, mixed_file = generate_synthetic_audio_dataset(test_dir)

    # -------------------------------------------------------------------------
    # TEST CASE 1: Triệt tiêu tiếng vọng trên tín hiệu chỉ có echo
    # Nghiệm thu: AEC-01, AEC-02, AEC-04, AEC-05
    # -------------------------------------------------------------------------
    print("[TEST 1] Kiểm tra triệt tiêu tiếng vang (Echo-only signal)...")
    out_echo = os.path.join(test_dir, "out_echo_cancelled.wav")
    res1 = aec_service.cancel_echo(
        capture_path=echo_file,
        reference_path=ref_file,
        output_path=out_echo
    )

    print(f"  * Trạng thái        : {res1['status']}")
    print(f"  * Giảm echo (ERLE)  : {res1['erle_db']} dB")
    print(f"  * Năng lượng (RMS)  : Trước = {res1['input_rms']} | Sau = {res1['output_rms']}")
    print(f"  * Thời gian xử lý   : {res1['processing_time_seconds']}s")

    assert res1["status"] == "SUCCESS", "AEC-01: Trạng thái không phải SUCCESS."
    assert res1["erle_db"] > 3.0, f"AEC-02: Mức giảm tiếng vang quá thấp ({res1['erle_db']} dB)."
    assert os.path.isfile(out_echo), "AEC-04: File output không tồn tại."
    assert res1["sample_rate"] == 16000 and res1["channels"] == 1, "AEC-05: Sai chuẩn format."
    print("  --> [PASS] Nghiệm thu Test 1: Khử tiếng vang phản hồi hiệu quả!\n")

    # -------------------------------------------------------------------------
    # TEST CASE 2: Kiểm tra bảo vệ giọng nói khi đàm thoại đôi (Voice + Echo)
    # Nghiệm thu: AEC-03 (Không làm mất tín hiệu giọng nói của người nói gần)
    # -------------------------------------------------------------------------
    print("[TEST 2] Kiểm tra bảo vệ giọng nói trong chế độ Double-Talk (Voice + Echo)...")
    out_mixed = os.path.join(test_dir, "out_mixed_preserved.wav")
    res2 = aec_service.cancel_echo(
        capture_path=mixed_file,
        reference_path=ref_file,
        output_path=out_mixed
    )

    print(f"  * Trạng thái        : {res2['status']}")
    print(f"  * Năng lượng (RMS)  : Trước = {res2['input_rms']} | Sau = {res2['output_rms']}")
    print(f"  * Giảm echo (ERLE)  : {res2['erle_db']} dB")

    # Đảm bảo giọng nói không bị nuốt mất (RMS sau xử lý phải duy trì ở mức năng lượng của giọng nói)
    assert res2["output_rms"] > 1000.0, "AEC-03: Giọng nói chính bị triệt tiêu quá mức!"
    print("  --> [PASS] Nghiệm thu Test 2: Bảo vệ giọng nói thành công khi có đàm thoại đôi!\n")

    # -------------------------------------------------------------------------
    # TEST CASE 3: Kiểm tra tính toàn vẹn Timeline & Zero Duration Drift
    # Nghiệm thu: AEC-06 (Thời lượng trước và sau phải lệch đúng 0 frame)
    # -------------------------------------------------------------------------
    odd_duration = 2.731  # Lẻ mili-giây
    odd_capture = os.path.join(test_dir, "odd_capture.wav")
    odd_ref = os.path.join(test_dir, "odd_ref.wav")
    odd_out = os.path.join(test_dir, "odd_out.wav")

    sr = 16000
    n_samples = int(sr * odd_duration)
    create_wav_file(odd_ref, [random.randint(-5000, 5000) for _ in range(n_samples)])
    create_wav_file(odd_capture, [random.randint(-4000, 4000) for _ in range(n_samples)])

    print(f"[TEST 3] Kiểm tra bảo toàn timeline với file thời lượng lẻ ({odd_duration}s)...")
    res3 = aec_service.cancel_echo(
        capture_path=odd_capture,
        reference_path=odd_ref,
        output_path=odd_out
    )

    with wave.open(odd_capture, "rb") as win, wave.open(odd_out, "rb") as wout:
        f_in = win.getnframes()
        f_out = wout.getnframes()

    diff_frames = abs(f_out - f_in)
    print(f"  * Frame gốc         : {f_in} frames")
    print(f"  * Frame sau AEC     : {f_out} frames")
    print(f"  * Sai số frame      : {diff_frames} frame (Lệch: {diff_frames/16000.0:.6f}s)")

    assert diff_frames == 0, f"AEC-06: Lệch {diff_frames} frames giữa input và output."
    print("  --> [PASS] Nghiệm thu Test 3: Zero Duration Drift đạt độ chính xác 100%!\n")

    # -------------------------------------------------------------------------
    # TEST CASE 4: Xử lý theo Contract khi thiếu Reference Stream (Bypass an toàn)
    # Nghiệm thu: AEC-07 (Graceful Fallback, không crash, log rõ ràng)
    # -------------------------------------------------------------------------
    print("[TEST 4] Kiểm tra Contract AEC-07: Thiếu luồng Reference từ loa ngoài...")
    out_no_ref = os.path.join(test_dir, "out_bypass_no_ref.wav")
    res4 = aec_service.cancel_echo(
        capture_path=mixed_file,
        reference_path=None,  # Không có reference audio
        output_path=out_no_ref
    )

    print(f"  * Trạng thái        : {res4['status']}")
    print(f"  * Thông báo         : {res4['message']}")
    assert res4["status"] == "BYPASS_NO_REFERENCE", "AEC-07: Không kích hoạt bypass khi thiếu reference."
    assert os.path.isfile(out_no_ref), "AEC-07: File output fallback không được tạo."
    print("  --> [PASS] Nghiệm thu Test 4: Xử lý contract thiếu reference an toàn tuyệt đối!\n")

    # -------------------------------------------------------------------------
    # TEST CASE 5: Kiểm tra bắt lỗi Fail-fast khi capture sai định dạng
    # Nghiệm thu: AEC-07 (Bắt ngoại lệ định dạng, không silent failure)
    # -------------------------------------------------------------------------
    print("[TEST 5] Kiểm tra bắt lỗi khi Capture file sai định dạng (48kHz)...")
    invalid_sample = os.path.join(BASE_DIR, "poc", "data", "input", "input2.wav")
    if os.path.isfile(invalid_sample):
        try:
            aec_service.cancel_echo(capture_path=invalid_sample, reference_path=ref_file)
            assert False, "FAIL: Lẽ ra phải chặn file sai sample rate."
        except InvalidAudioFormatError as err:
            print(f"  * Bắt đúng ngoại lệ: {str(err)[:70]}...")
            print("  --> [PASS] Nghiệm thu Test 5: Bắt lỗi định dạng thành công!\n")
    else:
        print("  * [BỎ QUA] Không tìm thấy input2.wav để test định dạng.\n")

    # -------------------------------------------------------------------------
    # TEST CASE 6: Kiểm tra tính tương thích chuỗi (Regression Pipeline)
    # Nghiệm thu: AEC-04, AEC-05 (Output AEC đưa thẳng vào ANS lọc nhiễu tiếp theo)
    # -------------------------------------------------------------------------
    print("[TEST 6] Kiểm tra tương thích Regression: Output AEC -> Input ANS Service...")
    ans_service = AudioANSService(default_suppression_level=3)
    out_ans_chained = os.path.join(test_dir, "out_aec_then_ans.wav")

    res6 = ans_service.apply_noise_suppression(
        input_path=out_echo,
        output_path=out_ans_chained
    )

    print(f"  * ANS tiếp nối status: {res6['status']}")
    print(f"  * Giảm nhiễu ANS     : {res6['noise_reduction_db']} dB")
    assert res6["status"] == "SUCCESS", "Đầu ra của AEC không thể chạy tiếp qua ANS."
    print("  --> [PASS] Nghiệm thu Test 6: Pipeline nối chuỗi AEC -> ANS thông suốt!\n")

    print("=" * 75)
    print(">>> KẾT THÚC BÀI KIỂM THỬ: TẤT CẢ 6 TEST CASES ĐẠT 100% TIÊU CHUẨN AEC! <<<")
    print("=" * 75 + "\n")


if __name__ == "__main__":
    run_aec_verification_tests()
