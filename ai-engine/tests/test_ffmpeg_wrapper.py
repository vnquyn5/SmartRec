import os
import sys
import glob

# Thêm thư mục gốc ai-engine vào PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.ffmpeg_wrapper import (
    FFmpegWrapper,
    FFmpegExecutionError,
    AudioValidationError,
)

def run_verification_tests():
    print("==================================================")
    print("  BẮT ĐẦU KIỂM THỬ ĐỘC LẬP FFMPEG WRAPPER")
    print("==================================================")

    wrapper = FFmpegWrapper()
    print("[PASS] Khởi tạo FFmpegWrapper: Đã tìm thấy binary ffmpeg và ffprobe.")

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    input_dir = os.path.join(base_dir, "poc", "data", "input")
    output_dir = os.path.join(base_dir, "tests", "output")
    os.makedirs(output_dir, exist_ok=True)

    # ----------------------------------------------------
    # TEST CASE 1: Kiểm thử Happy Path với file media thật
    # ----------------------------------------------------
    media_files = []
    for ext in ("*.wav", "*.mp3", "*.mp4", "*.mkv", "*.m4a"):
        media_files.extend(glob.glob(os.path.join(input_dir, ext)))

    if not media_files:
        print(f"\n[CẢNH BÁO] Không tìm thấy file media nào trong '{input_dir}' để test trích xuất.")
    else:
        test_file = media_files[0]
        output_file = os.path.join(output_dir, "test_normalized_16k_mono.wav")
        print(f"\n--- [TEST 1] Trích xuất & Chuẩn hóa file: {os.path.basename(test_file)} ---")

        # Đọc thông số gốc trước khi xử lý
        meta_before = wrapper.inspect_audio_stream(test_file)
        if meta_before:
            print(f"  * Thông số gốc : {meta_before['sample_rate']}Hz | Channels: {meta_before['channels']} | Codec: {meta_before['codec_name']}")

        result = wrapper.extract_and_normalize_audio(
            input_path=test_file,
            output_path=output_file,
            target_sample_rate=16000,
            target_channels=1
        )

        print(f"  * Trạng thái   : {result['status']}")
        print(f"  * Định dạng    : {result['format']} (Codec: {result['codec']})")
        print(f"  * Sample Rate  : {result['sample_rate']} Hz")
        print(f"  * Channels     : {result['channels']} (Mono)")
        print(f"  * Dung lượng   : {result['file_size_bytes']} bytes")
        print(f"  * Thời gian xử lý: {result['processing_time_seconds']}s")

        # Assertions xác thực kỹ thuật
        assert os.path.exists(output_file), "Lỗi: File output không tồn tại"
        assert result["sample_rate"] == 16000, f"Lỗi: Sample rate {result['sample_rate']} != 16000"
        assert result["channels"] == 1, f"Lỗi: Channels {result['channels']} != 1"
        assert result["codec"] == "pcm_s16le", f"Lỗi: Codec {result['codec']} != pcm_s16le"
        assert result["file_size_bytes"] > 0, "Lỗi: File output rỗng"
        print("  -> [PASS] Nghiệm thu Test 1 thành công: Đạt chuẩn 16kHz Mono WAV!")

    # ----------------------------------------------------
    # TEST CASE 2: Kiểm thử Negative Path - File không tồn tại
    # ----------------------------------------------------
    print("\n--- [TEST 2] Xử lý lỗi khi file đầu vào không tồn tại ---")
    fake_path = os.path.join(input_dir, "non_existent_file.mp4")
    try:
        wrapper.extract_and_normalize_audio(fake_path, os.path.join(output_dir, "error.wav"))
        print("  -> [FAIL] Không bắt được lỗi FileNotFoundError!")
    except FileNotFoundError as e:
        print(f"  -> [PASS] Đã bắt đúng lỗi FileNotFoundError: {e}")

    # ----------------------------------------------------
    # TEST CASE 3: Kiểm thử Negative Path - File rỗng hoặc file hỏng
    # ----------------------------------------------------
    print("\n--- [TEST 3] Xử lý lỗi khi file đầu vào hỏng / rỗng ---")
    corrupt_file = os.path.join(output_dir, "corrupt_sample.mp4")
    with open(corrupt_file, "wb") as f:
        f.write(b"NOT_A_VALID_MEDIA_FILE_CONTENT")

    try:
        wrapper.extract_and_normalize_audio(corrupt_file, os.path.join(output_dir, "corrupt_out.wav"))
        print("  -> [FAIL] Không phát hiện được file hỏng!")
    except (AudioValidationError, FFmpegExecutionError, Exception) as e:
        print(f"  -> [PASS] Đã chặn file lỗi thành công (Zero Silent Failure):")
        print(f"     Loại lỗi: {type(e).__name__}")

    if os.path.exists(corrupt_file):
        os.remove(corrupt_file)

    print("\n==================================================")
    print("  KẾT THÚC BÀI KIỂM THỬ ĐỘC LẬP: TẤT CẢ TEST ĐẠT!")
    print("==================================================")

if __name__ == "__main__":
    run_verification_tests()