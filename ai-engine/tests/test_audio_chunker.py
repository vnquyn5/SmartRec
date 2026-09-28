import os
import sys
import json
import time
import shutil
import subprocess

# Thêm thư mục gốc ai-engine vào PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.audio_chunker import (
    AudioChunker,
    AudioDurationExceededError
)
from app.services.ffmpeg_wrapper import FFmpegWrapper


def create_synthetic_audio(output_path: str, duration_seconds: float):
    """Tạo nhanh file âm thanh WAV 16kHz Mono rỗng (silent) bằng FFmpeg để kiểm thử boundary."""
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", "anullsrc=r=16000:cl=mono",
        "-t", str(duration_seconds),
        "-acodec", "pcm_s16le",
        output_path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def run_chunker_tests():
    print("==================================================")
    print("  BẮT ĐẦU KIỂM THỬ ĐỘC LẬP AUDIO CHUNKER (TASK 2.8.2)")
    print("==================================================")

    wrapper = FFmpegWrapper()
    chunker = AudioChunker(wrapper=wrapper)
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    test_dir = os.path.join(base_dir, "tests", "output", "chunker_test")
    os.makedirs(test_dir, exist_ok=True)

    # ----------------------------------------------------
    # TEST 1: Audio <= 2 giờ (Thời lượng 50s thực tế)
    # ----------------------------------------------------
    print("\n--- [TEST 1] Audio <= 2 giờ: Không chia chunk (Skip) ---")
    short_file = os.path.join(base_dir, "poc", "data", "input", "input2_normalized_16k.wav")
    if not os.path.exists(short_file):
        short_file = os.path.join(base_dir, "poc", "data", "input", "input2.wav")

    res_short = chunker.process_audio(input_path=short_file)
    print(f"  * Tổng thời lượng : {res_short['total_duration_seconds']}s")
    print(f"  * Trạng thái      : {res_short['status']}")
    print(f"  * Có chia chunk   : {res_short['is_chunked']}")
    print(f"  * Thông báo       : {res_short['message']}")

    assert res_short["status"] == "SKIPPED", "Lỗi: File <= 2h không được đánh dấu SKIPPED"
    assert res_short["is_chunked"] is False, "Lỗi: is_chunked phải là False"
    assert res_short["manifest"] is None, "Lỗi: File <= 2h không được sinh manifest"
    print("  -> [PASS] Nghiệm thu Test 1: Bỏ qua chia chunk đúng quy tắc!")

    # ----------------------------------------------------
    # TEST 2: Audio 02:30:00 (9,000s) -> Chia chunk 40 phút
    # ----------------------------------------------------
    print("\n--- [TEST 2] Audio 02:30:00 (9,000s): Chia 4 chunks 30-45 phút + Manifest ---")
    synth_2h30 = os.path.join(test_dir, "synth_meeting_02h30m.wav")
    chunks_out_dir = os.path.join(test_dir, "synth_meeting_02h30m_chunks")

    print("  * Đang khởi tạo file âm thanh mô phỏng 02:30:00 (9,000s)...")
    t0 = time.time()
    create_synthetic_audio(synth_2h30, 9000.0)
    print(f"  * Tạo file hoàn tất trong {time.time() - t0:.2f}s (~{os.path.getsize(synth_2h30) / (1024*1024):.1f} MB)")

    res_chunk = chunker.process_audio(
        input_path=synth_2h30,
        output_dir=chunks_out_dir,
        target_chunk_duration=2400.0  # 40 phút chuẩn
    )

    print(f"  * Trạng thái      : {res_chunk['status']}")
    print(f"  * Số lượng chunks : {res_chunk['manifest']['chunk_count']}")
    print(f"  * File manifest   : {res_chunk['manifest_file']}")

    manifest = res_chunk["manifest"]
    assert res_chunk["status"] == "SUCCESS"
    assert res_chunk["is_chunked"] is True
    assert manifest["chunk_count"] == 4, f"Lỗi: Số chunk {manifest['chunk_count']} != 4"
    assert os.path.exists(res_chunk["manifest_file"]), "Lỗi: File manifest.json không tồn tại"

    print("\n  * Chi tiết các chunk sinh ra từ Manifest:")
    sum_duration = 0.0
    for c in manifest["chunks"]:
        print(f"    - Chunk {c['chunk_index']}: {c['start']} -> {c['end']} | Độ dài: {c['duration']}s | File: {c['file_name']}")
        assert os.path.exists(c["file_path"]), f"File chunk không tồn tại: {c['file_path']}"
        sum_duration += c["duration"]

    # Kiểm tra tính liên tục của timeline
    assert manifest["chunks"][0]["start"] == "00:00:00"
    assert manifest["chunks"][0]["end"] == "00:40:00"
    assert manifest["chunks"][1]["start"] == "00:40:00"
    assert manifest["chunks"][1]["end"] == "01:20:00"
    assert manifest["chunks"][2]["start"] == "01:20:00"
    assert manifest["chunks"][2]["end"] == "02:00:00"
    assert manifest["chunks"][3]["start"] == "02:00:00"
    assert manifest["chunks"][3]["end"] == "02:30:00"
    assert abs(sum_duration - 9000.0) < 1.0, "Lỗi: Tổng thời lượng các chunk không khớp file gốc"

    print("  -> [PASS] Nghiệm thu Test 2: Chunking & Manifest chính xác 100%!")

    # Dọn dẹp file lớn của Test 2
    if os.path.exists(synth_2h30):
        os.remove(synth_2h30)
    if os.path.exists(chunks_out_dir):
        shutil.rmtree(chunks_out_dir)

    # ----------------------------------------------------
    # TEST 3: Audio > 4 giờ (14,405s) -> Từ chối xử lý
    # ----------------------------------------------------
    print("\n--- [TEST 3] Audio > 4 giờ: Reject theo Business Boundary ---")
    synth_over_4h = os.path.join(test_dir, "synth_over_4h.wav")
    print("  * Khởi tạo file mô phỏng 04:00:05 (14,405s)...")
    create_synthetic_audio(synth_over_4h, 14405.0)

    try:
        chunker.process_audio(input_path=synth_over_4h)
        print("  -> [FAIL] Không bắt được lỗi AudioDurationExceededError!")
        assert False, "Phải ném AudioDurationExceededError"
    except AudioDurationExceededError as e:
        print(f"  -> [PASS] Đã từ chối file > 4h thành công:")
        print(f"     Nội dung lỗi: {e}")
    finally:
        if os.path.exists(synth_over_4h):
            os.remove(synth_over_4h)

    # ----------------------------------------------------
    # TEST 4: File không tồn tại
    # ----------------------------------------------------
    print("\n--- [TEST 4] Xử lý lỗi khi file đầu vào không tồn tại ---")
    try:
        chunker.process_audio(input_path="invalid_path.wav")
        assert False, "Phải ném FileNotFoundError"
    except FileNotFoundError as e:
        print(f"  -> [PASS] Bắt lỗi chính xác: {e}")

    # Xóa thư mục test tạm
    if os.path.exists(test_dir):
        shutil.rmtree(test_dir)

    print("\n==================================================")
    print("  KẾT THÚC BÀI KIỂM THỬ: TẤT CẢ TEST CASE ĐẠT 100%!")
    print("==================================================")


if __name__ == "__main__":
    run_chunker_tests()