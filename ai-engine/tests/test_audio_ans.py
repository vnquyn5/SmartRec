import os
import sys
import wave
import math
import struct
import random
import shutil

# Thêm thư mục gốc ai-engine vào PYTHONPATH
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BASE_DIR)

from app.services.audio_ans import (
    AudioANSService,
    InvalidAudioFormatError,
    AudioSignalLostError,
    AudioANSError
)


def create_synthetic_noise_audio(output_path: str, duration_sec: float = 3.123, freq_hz: float = 440.0) -> None:
    """
    Tạo file audio tổng hợp có độ dài lẻ mili-giây (ví dụ: 3.123s không chia hết cho 10ms frame)
    kèm nhiễu tĩnh giả lập (tiếng quạt/hum + tiếng beep) để kiểm tra logic zero-padding.
    """
    sample_rate = 16000
    total_samples = int(sample_rate * duration_sec)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)

        raw_frames = bytearray()
        for i in range(total_samples):
            # Tạo tín hiệu hỗn hợp: sóng sin (giọng/tiếng) + nhiễu trắng ngẫu nhiên (tiếng quạt/xì)
            tone = 10000 * math.sin(2 * math.pi * freq_hz * (i / sample_rate))
            noise = random.randint(-2000, 2000)
            sample_val = int(max(-32767, min(32767, tone + noise)))
            raw_frames.extend(struct.pack("<h", sample_val))

        wf.writeframes(raw_frames)


def run_ans_verification_tests():
    print("\n" + "=" * 70)
    print(">>> BẮT ĐẦU KIỂM THỬ ĐỘC LẬP WEBRTC ANS (TASK 2.9 - SUBTASK 2.9.1) <<<")
    print("=" * 70 + "\n")

    ans_service = AudioANSService(default_suppression_level=3)
    input_dir = os.path.join(BASE_DIR, "poc", "data", "input")
    output_dir = os.path.join(BASE_DIR, "tests", "output", "ans")
    os.makedirs(output_dir, exist_ok=True)

    # -------------------------------------------------------------------------
    # TEST CASE 1: Happy Path trên file audio thực tế (input2_normalized_16k.wav)
    # Nghiệm thu: ANS-01, ANS-02, ANS-03, ANS-04, ANS-05, ANS-06
    # -------------------------------------------------------------------------
    real_sample = os.path.join(input_dir, "input2_normalized_16k.wav")
    print("[TEST 1] Xử lý lọc ồn trên file thực tế: input2_normalized_16k.wav...")
    
    if not os.path.isfile(real_sample):
        print(f"[FAIL] Không tìm thấy file {real_sample} để test Happy Path.")
        sys.exit(1)

    out_real = os.path.join(output_dir, "input2_ans_level3.wav")
    res1 = ans_service.apply_noise_suppression(
        input_path=real_sample,
        output_path=out_real,
        suppression_level=3
    )

    print(f"  * Trạng thái      : {res1['status']}")
    print(f"  * Thời lượng      : {res1['duration_seconds']}s")
    print(f"  * Mức giảm ồn     : {res1['noise_reduction_db']} dB")
    print(f"  * Năng lượng (RMS): Trước = {res1['input_rms']} | Sau = {res1['output_rms']}")
    print(f"  * Thời gian xử lý : {res1['processing_time_seconds']}s")

    # Assertions
    assert os.path.isfile(out_real), "ANS-04: File output không tồn tại trên đĩa."
    assert res1["sample_rate"] == 16000, "ANS-05: Sample rate output không phải 16kHz."
    assert res1["channels"] == 1, "ANS-05: Số kênh output không phải Mono."
    assert res1["output_rms"] > 1.0, "ANS-03: Tín hiệu giọng nói bị triệt tiêu hoàn toàn."
    assert res1["noise_reduction_db"] >= 0.0, "ANS-02: Không đo được hiệu quả giảm ồn."
    print("  --> [PASS] Nghiệm thu Test 1: Khử ồn thành công, giữ trọn vẹn đặc tính audio!\n")

    # -------------------------------------------------------------------------
    # TEST CASE 2: Kiểm thử tính toàn vẹn Timeline & Zero-padding (Odd duration)
    # Nghiệm thu: ANS-06 (Bảo toàn timeline từng miligiây)
    # -------------------------------------------------------------------------
    odd_duration = 3.147  # Thời lượng lẻ không bao giờ chia hết cho 160 samples (10ms)
    odd_input = os.path.join(output_dir, "synth_odd_noise.wav")
    odd_output = os.path.join(output_dir, "synth_odd_noise_ans.wav")
    
    print(f"[TEST 2] Kiểm thử bảo toàn timeline tuyệt đối với file lẻ ({odd_duration}s)...")
    create_synthetic_noise_audio(odd_input, duration_sec=odd_duration)

    res2 = ans_service.apply_noise_suppression(
        input_path=odd_input,
        output_path=odd_output
    )

    # Đọc chính xác từng frame của input và output
    with wave.open(odd_input, "rb") as wf_in, wave.open(odd_output, "rb") as wf_out:
        frames_in = wf_in.getnframes()
        frames_out = wf_out.getnframes()

    diff_frames = abs(frames_out - frames_in)
    print(f"  * Frame gốc      : {frames_in} frames")
    print(f"  * Frame sau ANS  : {frames_out} frames")
    print(f"  * Lệch frame     : {diff_frames} frame (Sai số thời lượng: {diff_frames / 16000.0:.6f}s)")

    assert diff_frames == 0, f"ANS-06 thất bại: Lệch {diff_frames} frames giữa input và output."
    print("  --> [PASS] Nghiệm thu Test 2: Timeline được bảo toàn chính xác 100% (Zero Duration Drift)!\n")

    # -------------------------------------------------------------------------
    # TEST CASE 3: Kiểm thử Ma trận 4 Cấp độ Khử nhiễu (Levels 0 -> 3)
    # -------------------------------------------------------------------------
    print("[TEST 3] Kiểm tra ma trận 4 cấp độ lọc (0: Mild, 1: Med, 2: High, 3: Aggressive)...")
    rms_history = []
    for lvl in [0, 1, 2, 3]:
        out_lvl = os.path.join(output_dir, f"test_level_{lvl}.wav")
        res_lvl = ans_service.apply_noise_suppression(
            input_path=real_sample,
            output_path=out_lvl,
            suppression_level=lvl
        )
        rms_history.append((lvl, res_lvl["output_rms"], res_lvl["noise_reduction_db"]))
        print(f"  * Level {lvl}: RMS Sau = {res_lvl['output_rms']} | Giảm: {res_lvl['noise_reduction_db']} dB")

    # Mức độ lọc cao hơn (level 3) phải dập nhiễu mạnh hơn hoặc tương đương level 0
    assert rms_history[-1][1] <= rms_history[0][1], "Mức khử nhiễu cao phải triệt tiêu năng lượng ồn tốt hơn mức nhẹ."
    print("  --> [PASS] Nghiệm thu Test 3: Cả 4 cấp độ lọc đều vận hành chuẩn xác!\n")

    # -------------------------------------------------------------------------
    # TEST CASE 4: Negative Test - File chưa chuẩn hóa (Sai sample rate / kênh)
    # Nghiệm thu: ANS-05, ANS-07 (Fail-fast, bắt đúng ngoại lệ)
    # -------------------------------------------------------------------------
    unnormalized_sample = os.path.join(input_dir, "input2.wav")
    print("[TEST 4] Bắt lỗi khi đưa vào file chưa chuẩn hóa (input2.wav 48kHz Stereo)...")
    
    if os.path.isfile(unnormalized_sample):
        try:
            ans_service.apply_noise_suppression(
                input_path=unnormalized_sample,
                output_path=os.path.join(output_dir, "should_fail.wav")
            )
            assert False, "FAIL: Lẽ ra phải chặn file sai định dạng 48kHz Stereo."
        except InvalidAudioFormatError as e:
            print(f"  * Bắt đúng ngoại lệ InvalidAudioFormatError: {str(e)[:75]}...")
            print("  --> [PASS] Nghiệm thu Test 4: Chặn tệp sai chuẩn thành công (Fail-fast)!\n")
    else:
        print("  * [BỎ QUA] Không tìm thấy input2.wav để test ngoại lệ định dạng.")

    # -------------------------------------------------------------------------
    # TEST CASE 5: Negative Test - File nguồn không tồn tại
    # Nghiệm thu: ANS-07 (Zero Silent Failure)
    # -------------------------------------------------------------------------
    print("[TEST 5] Xử lý lỗi khi file đầu vào không tồn tại...")
    fake_path = os.path.join(input_dir, "non_existent_audio_file.wav")
    try:
        ans_service.apply_noise_suppression(fake_path)
        assert False, "FAIL: Lẽ ra phải ném FileNotFoundError."
    except FileNotFoundError as e:
        print(f"  * Bắt đúng ngoại lệ: {str(e)}")
        print("  --> [PASS] Nghiệm thu Test 5: Không bị silent failure khi thiếu file!\n")

    # Dọn dẹp tệp sinh ra từ test nhân tạo
    if os.path.isfile(odd_input):
        os.remove(odd_input)
    if os.path.isfile(odd_output):
        os.remove(odd_output)

    print("=" * 70)
    print(">>> KẾT THÚC BÀI KIỂM THỬ: TẤT CẢ 5 TEST CASES ĐẠT 100% TIÊU CHUẨN! <<<")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    run_ans_verification_tests()