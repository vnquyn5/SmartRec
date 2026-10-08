import os
import wave
import time
import math
import struct
import uuid
import shutil
import tempfile
import numpy as np
import sys
from pathlib import Path

# Nạp thư mục gốc ai-engine vào sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from unittest.mock import patch

from app.schemas.audio_schemas import AudioPipelineRequest
from app.services.audio_pipeline import AudioPipelineOrchestrator
from app.services.audio_chunker import AudioChunker, AudioChunkerError
from app.services.audio_aec import AudioAECService


def test_pipeline_full_flow():
    print("\n[TEST 1] Kiểm tra luồng Pipeline hoàn chỉnh (Validate -> AEC -> ANS -> Quality Check)...")
    test_dir = tempfile.mkdtemp(prefix="test_pipe_full_")
    try:
        job_id = "JOB-PIPE-001"
        req = AudioPipelineRequest(
            job_id=job_id,
            input_path="poc/data/input/input2_normalized_16k.wav",
            reference_path="poc/data/input/input2_normalized_16k.wav",
            output_dir=test_dir,
            suppression_level=3
        )
        orchestrator = AudioPipelineOrchestrator()
        t0 = time.time()
        res = orchestrator.process_pipeline(req)
        elapsed = round(time.time() - t0, 3)

        assert res.overall_status == "SUCCESS", f"Pipeline thất bại: {res.error_message}"
        assert len(res.step_logs) == 4, f"Số bước không đủ: {len(res.step_logs)}"
        assert res.final_output_file is not None, "Thiếu final_output_file"
        assert job_id in os.path.basename(res.final_output_file), "Tên output không chứa job_id."
        assert res.quality_check.passed is True, "Quality Check thất bại."
        assert res.quality_check.duration_drift_samples == 0, "Vi phạm Zero Drift."

        print(f"  * Job ID                : {res.job_id}")
        print(f"  * Overall Status        : {res.overall_status}")
        print(f"  * Tổng thời gian xử lý  : {elapsed}s")
        for step in res.step_logs:
            print(f"    - [{step.step}] Status: {step.status} | Duration: {step.processing_time_seconds}s")
        print("  --> [PASS] Nghiệm thu Test 1: Zero Drift = 0 mẫu, log chuẩn xác!")
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_pipeline_bypass_aec():
    print("\n[TEST 2] Kiểm tra Pipeline khi thiếu Reference audio (Graceful Bypass AEC)...")
    test_dir = tempfile.mkdtemp(prefix="test_pipe_bypass_")
    try:
        # 2A: Người dùng chủ động không truyền reference
        req = AudioPipelineRequest(
            job_id="JOB-PIPE-002A",
            input_path="poc/data/input/input2_normalized_16k.wav",
            reference_path=None,
            output_dir=test_dir
        )
        orchestrator = AudioPipelineOrchestrator()
        res = orchestrator.process_pipeline(req)
        assert res.overall_status == "SUCCESS"
        aec_log = next(s for s in res.step_logs if s.step == "AEC")
        assert aec_log.status == "BYPASS_NO_REFERENCE"
        print("  * [2A] Không truyền reference -> Trạng thái: BYPASS_NO_REFERENCE")

        # 2B: Truyền reference lỗi -> Bắt buộc log warning và gán BYPASS_INVALID_REFERENCE
        corrupt_ref = os.path.join(test_dir, "corrupt_ref_48k.wav")
        with wave.open(corrupt_ref, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(48000)
            wf.writeframes(b"\x00\x00" * 480)

        req_corrupt = AudioPipelineRequest(
            job_id="JOB-PIPE-002B",
            input_path="poc/data/input/input2_normalized_16k.wav",
            reference_path=corrupt_ref,
            output_dir=test_dir
        )
        with patch("app.services.audio_pipeline.logger.warning") as mock_ref_warn:
            res_corrupt = orchestrator.process_pipeline(req_corrupt)
            assert res_corrupt.overall_status == "SUCCESS"
            aec_corrupt_log = next(s for s in res_corrupt.step_logs if s.step == "AEC")
            assert aec_corrupt_log.status == "BYPASS_INVALID_REFERENCE"
            assert aec_corrupt_log.error_message is not None

            # Khẳng định trực tiếp logger.warning đã được kích hoạt
            assert mock_ref_warn.called, "logger.warning phải được gọi khi reference không hợp lệ!"
            warn_msg = mock_ref_warn.call_args[0][0]
            assert "PIPE-AEC" in warn_msg and "Reference audio không hợp lệ" in warn_msg
            print(f"  * [2B] Assert trực tiếp Logger Warning: \"{warn_msg}\"")
        print("  --> [PASS] Nghiệm thu Test 2: Phân định rạch ròi trạng thái và xác minh logger.warning trực tiếp!")
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_pipeline_validation_failure():
    print("\n[TEST 3] Kiểm tra bắt lỗi đầu vào và ghi log thất bại (PIPE-01, PIPE-08)...")
    test_dir = tempfile.mkdtemp(prefix="test_pipe_val_")
    try:
        bad_sample_file = os.path.join(test_dir, "bad_48k.wav")
        with wave.open(bad_sample_file, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(48000)
            wf.writeframes(b"\x00\x00" * 480)

        req = AudioPipelineRequest(
            job_id="JOB-PIPE-003",
            input_path=bad_sample_file,
            output_dir=test_dir
        )
        orchestrator = AudioPipelineOrchestrator()
        res = orchestrator.process_pipeline(req)

        assert res.overall_status == "FAILED"
        assert "48000Hz không đúng chuẩn" in res.error_message
        val_log = next(s for s in res.step_logs if s.step == "VALIDATION")
        assert val_log.status == "FAILED"
        print("  --> [PASS] Nghiệm thu Test 3: Bắt lỗi đầu vào và ghi log nguyên nhân rõ ràng!")
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_pipeline_silence_detection():
    print("\n[TEST 4] Kiểm tra Quality Check phát hiện tín hiệu im lặng (Silence Detection)...")
    test_dir = tempfile.mkdtemp(prefix="test_pipe_silence_")
    try:
        silent_file = os.path.join(test_dir, "silent.wav")
        with wave.open(silent_file, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(b"\x00\x00" * 16000)

        req = AudioPipelineRequest(
            job_id="JOB-PIPE-004",
            input_path=silent_file,
            output_dir=test_dir
        )
        orchestrator = AudioPipelineOrchestrator()
        res = orchestrator.process_pipeline(req)

        assert res.overall_status == "FAILED"
        assert res.quality_check.is_silent is True
        print("  --> [PASS] Nghiệm thu Test 4: Quality Check chặn đứng file im lặng!")
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_pipeline_clipping_gate():
    print("\n[TEST 5] Kiểm tra Quality Gate ranh giới clipping 0.5% và âm lượng gần 0 dBFS...")
    test_dir = tempfile.mkdtemp(prefix="test_pipe_clip_")
    try:
        orchestrator = AudioPipelineOrchestrator()
        sample_rate = 16000
        n_samples = 16000

        # 5A: Âm thanh lớn gần 0 dBFS (peak 32000 ~ -0.2 dBFS), sóng sin không bẹt đầu -> Phải PASS
        safe_loud_file = os.path.join(test_dir, "safe_loud.wav")
        safe_samples = [int(32000 * math.sin(2 * math.pi * 440 * i / sample_rate)) for i in range(n_samples)]
        with wave.open(safe_loud_file, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(struct.pack(f"<{n_samples}h", *safe_samples))

        qc_safe = orchestrator._perform_quality_check(safe_loud_file, expected_frames=n_samples)
        assert qc_safe.passed is True
        assert qc_safe.is_clipped is False
        print(f"  * [5A - Peak ~0 dBFS không bẹt đầu] Passed: {qc_safe.passed} | Is Clipped: {qc_safe.is_clipped}")

        # 5B: Tỷ lệ clipping 0.4% (64 mẫu <= 0.005) -> Phải PASS
        sub_thresh_file = os.path.join(test_dir, "sub_threshold_clip.wav")
        sub_samples = [int(1000 * math.sin(2 * math.pi * 440 * i / sample_rate)) for i in range(n_samples)]
        for i in range(64):
            sub_samples[i] = 32767
        with wave.open(sub_thresh_file, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(struct.pack(f"<{n_samples}h", *sub_samples))

        qc_sub = orchestrator._perform_quality_check(sub_thresh_file, expected_frames=n_samples)
        assert qc_sub.passed is True
        assert qc_sub.is_clipped is False
        print(f"  * [5B - Clipping 0.4% <= 0.5%] Passed: {qc_sub.passed} | Is Clipped: {qc_sub.is_clipped}")

        # 5C: Tỷ lệ clipping 0.6% (96 mẫu > 0.005) -> Phải FAIL
        over_thresh_file = os.path.join(test_dir, "over_threshold_clip.wav")
        over_samples = [int(1000 * math.sin(2 * math.pi * 440 * i / sample_rate)) for i in range(n_samples)]
        for i in range(96):
            over_samples[i] = 32767
        with wave.open(over_thresh_file, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(struct.pack(f"<{n_samples}h", *over_samples))

        qc_over = orchestrator._perform_quality_check(over_thresh_file, expected_frames=n_samples)
        assert qc_over.passed is False
        assert qc_over.is_clipped is True
        print(f"  * [5C - Clipping 0.6% > 0.5%] Passed: {qc_over.passed} | Is Clipped: {qc_over.is_clipped}")
        print("  --> [PASS] Nghiệm thu Test 5: Khẳng định tuyệt đối ranh giới clipping 0.5%!")
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_pipeline_downstream_chunker():
    print("\n[TEST 6] Kiểm tra tích hợp chuyển tiếp output sang AudioChunker & Guard Validation...")
    test_dir = tempfile.mkdtemp(prefix="test_pipe_chunk_")
    try:
        sample_audio = "poc/data/input/input2_normalized_16k.wav"
        if not os.path.exists(sample_audio):
            sample_audio = "poc/data/input/input2.wav"

        chunker = AudioChunker()

        # 6A: Guard validation kiểm tra target_chunk_duration không hợp lệ (NaN, Inf, <= 0)
        invalid_values = [0, -10.0, float("nan"), float("inf")]
        for inv in invalid_values:
            try:
                chunker.process_audio(input_path=sample_audio, target_chunk_duration=inv)
                assert False, f"Chunker phải từ chối giá trị: {inv}"
            except AudioChunkerError:
                pass
        print("  * [6A - Guard Clause] Từ chối thành công 0, số âm, NaN và Infinity.")

        # 6B: Pipeline xử lý và xuất final_output_file thực tế
        orchestrator = AudioPipelineOrchestrator()
        pipe_req = AudioPipelineRequest(
            job_id="JOB-PIPE-CHUNK-01",
            input_path=sample_audio,
            output_dir=os.path.join(test_dir, "pipe_out")
        )
        pipe_res = orchestrator.process_pipeline(pipe_req)
        assert pipe_res.overall_status == "SUCCESS"
        pipeline_final_output = pipe_res.final_output_file

        # Skip khi <= 2h
        res_skip = chunker.process_audio(input_path=pipeline_final_output, output_dir=os.path.join(test_dir, "chunks_skip"))
        assert res_skip["status"] == "SKIPPED"

        # Mock mô phỏng 9000s (> 2h)
        simulated_duration = 9000.0
        def mock_inspect(path):
            return {"duration_seconds": simulated_duration, "sample_rate": 16000, "channels": 1, "bit_depth": 16}
        def mock_slice(input_path, output_path, start_seconds, duration_seconds):
            with open(output_path, "wb") as f:
                f.write(b"RIFF_MOCK_CHUNK_DATA")

        with patch.object(chunker.wrapper, "inspect_audio_stream", side_effect=mock_inspect), \
             patch.object(chunker.wrapper, "slice_audio", side_effect=mock_slice):

            res_chunk = chunker.process_audio(
                input_path=pipeline_final_output,
                output_dir=os.path.join(test_dir, "chunks_active"),
                target_chunk_duration=2400.0
            )
            assert res_chunk["status"] == "SUCCESS"
            assert res_chunk["manifest"]["chunk_count"] == 4
            chunks = res_chunk["manifest"]["chunks"]

            # Khẳng định chính xác từng mốc thời gian trung gian theo chuẩn HH:MM:SS
            assert chunks[0]["start"] == "00:00:00" and chunks[0]["end"] == "00:40:00"
            assert chunks[1]["start"] == "00:40:00" and chunks[1]["end"] == "01:20:00"
            assert chunks[2]["start"] == "01:20:00" and chunks[2]["end"] == "02:00:00"
            assert chunks[3]["start"] == "02:00:00" and chunks[3]["end"] == "02:30:00"

            # Khẳng định tính liên tục toán học (seamless continuity) giữa các chunk liên tiếp
            for i in range(len(chunks) - 1):
                assert chunks[i]["end"] == chunks[i + 1]["start"], f"Lệch mốc chuỗi: {chunks[i]['end']} != {chunks[i+1]['start']}"
                assert math.isclose(chunks[i]["end_seconds"], chunks[i + 1]["start_seconds"], abs_tol=1e-3), "Lệch mốc giây!"

            total_calc_duration = sum(c["duration"] for c in chunks)
            assert math.isclose(total_calc_duration, simulated_duration, abs_tol=1e-3)
            print(f"  * [6B - Manifest Timeline] 4 mốc chuẩn xác: 00:00 -> 00:40 -> 01:20 -> 02:00 -> 02:30 (Liên tục 100%)")

        print("  --> [PASS] Nghiệm thu Test 6: Pipeline output -> Chunker và Manifest continuity hoàn hảo!")
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_quality_check_invalid_bit_depth():
    print("\n[TEST 7] Kiểm tra Quality Gate xử lý file sai bit depth (8-bit thay vì PCM 16-bit)...")
    test_dir = tempfile.mkdtemp(prefix="test_qc_bit_")
    try:
        bad_bit_path = os.path.join(test_dir, "bad_8bit.wav")
        with wave.open(bad_bit_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(1)
            wf.setframerate(16000)
            wf.writeframes(b"\x80" * 1600)

        orchestrator = AudioPipelineOrchestrator()
        qc = orchestrator._perform_quality_check(bad_bit_path, expected_frames=1600)
        assert qc.passed is False
        assert "Độ sâu bit không đạt chuẩn PCM 16-bit" in qc.error_message
        print("  --> [PASS] Nghiệm thu Test 7: Bắt gọn file sai bit depth!")
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_pipeline_cleanup_oserror_warning():
    print("\n[TEST 8] Kiểm tra cơ chế xử lý lỗi khi tạo workspace và cleanup...")
    isolated_test_dir = tempfile.mkdtemp(prefix="test_qc_cleanup_")
    try:
        dummy_input = os.path.join(isolated_test_dir, "dummy_in.wav")
        with wave.open(dummy_input, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(b"\x00\x00" * 160)

        orchestrator = AudioPipelineOrchestrator()

        # 8A: Test lỗi khi tạo workspace (Permission denied) -> Phải trả về overall_status = FAILED
        with patch("os.makedirs", side_effect=PermissionError("Quyền truy cập bị từ chối")):
            req_fail = AudioPipelineRequest(
                job_id="JOB-ERR-WORKSPACE",
                input_path=dummy_input,
                output_dir=isolated_test_dir
            )
            res_fail = orchestrator.process_pipeline(req_fail)
            assert res_fail.overall_status == "FAILED"
            assert "Quyền truy cập bị từ chối" in res_fail.error_message
            print("  * [8A] Tạo workspace thất bại -> Bắt lỗi có cấu trúc, status = FAILED")

        # 8B: Test cleanup gặp OSError -> Phải log warning
        req = AudioPipelineRequest(
            job_id="JOB-ERR-CLEANUP",
            input_path=dummy_input,
            output_dir=isolated_test_dir
        )
        with patch("shutil.rmtree", side_effect=OSError("Permission denied (EACCES)")):
            with patch.object(orchestrator, "_perform_quality_check") as mock_qc:
                from app.schemas.audio_schemas import QualityCheckMetrics
                mock_qc.return_value = QualityCheckMetrics(
                    passed=False,
                    sample_rate=16000,
                    channels=1,
                    duration_seconds=0.01,
                    file_size_bytes=320,
                    rms_energy=0.0,
                    is_silent=True,
                    is_clipped=False,
                    duration_drift_samples=0,
                    error_message="Test cleanup failure"
                )
                with patch("app.services.audio_pipeline.logger.warning") as mock_warn:
                    res = orchestrator.process_pipeline(req)
                    assert res.overall_status == "FAILED"
                    assert mock_warn.called
                    print("  * [8B] Cleanup gặp OSError -> Ghi log warning chính xác.")
        print("  --> [PASS] Nghiệm thu Test 8: Workspace failure và Teardown cleanup đều đạt chuẩn!")
    finally:
        if os.path.exists(isolated_test_dir):
            shutil.rmtree(isolated_test_dir)


def test_aec_geigel_dtd_double_talk_protection():
    print("\n[TEST 9] Kiểm chứng thuật toán Geigel DTD trong tình huống Double-Talk...")
    test_dir = tempfile.mkdtemp(prefix="test_dtd_")
    try:
        ref_path = os.path.join(test_dir, "ref.wav")
        single_talk_path = os.path.join(test_dir, "single.wav")
        double_talk_path = os.path.join(test_dir, "double.wav")
        out_single = os.path.join(test_dir, "out_single.wav")
        out_double = os.path.join(test_dir, "out_double.wav")

        sample_rate = 16000
        n_samples = 16000

        # 1. Tạo Reference (Loa, amp ~ 3000)
        ref_samples = [int(3000 * math.sin(2 * math.pi * 440 * i / sample_rate)) for i in range(n_samples)]
        with wave.open(ref_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(struct.pack(f"<{n_samples}h", *ref_samples))

        # 2. Tạo Single-talk (Echo thuần amp ~ 1500)
        single_samples = [int(0.5 * ref_samples[i]) for i in range(n_samples)]
        with wave.open(single_talk_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(struct.pack(f"<{n_samples}h", *single_samples))

        # 3. Tạo Double-talk (Echo amp ~ 1500 + Giọng nói near-end lớn amp ~ 12000)
        double_samples = []
        for i in range(n_samples):
            echo = int(0.5 * ref_samples[i])
            near_speech = int(12000 * math.sin(2 * math.pi * 200 * i / sample_rate))
            double_samples.append(max(-32768, min(32767, echo + near_speech)))
        with wave.open(double_talk_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(struct.pack(f"<{n_samples}h", *double_samples))

        # 4. Kiểm chứng Single-talk: DTD không chặn, thích ứng bình thường
        aec_single = AudioAECService()
        res_single = aec_single.cancel_echo(single_talk_path, ref_path, out_single)
        assert res_single["status"] == "SUCCESS"
        assert aec_single.last_double_talk_count == 0, "Single-talk không được kích hoạt DTD nhầm!"
        weights_norm_single = float(np.linalg.norm(aec_single.last_filter_weights))
        assert weights_norm_single > 0.0
        print(f"  * [Single-talk] DTD Count: {aec_single.last_double_talk_count} | Weights Norm: {weights_norm_single:.4f}")

        # 5. Kiểm chứng Double-talk: DTD đóng băng toàn bộ 100% mẫu (16000/16000)
        aec_double = AudioAECService()
        res_double = aec_double.cancel_echo(double_talk_path, ref_path, out_double)
        assert res_double["status"] == "SUCCESS"
        assert aec_double.last_double_talk_count == n_samples, f"Kỳ vọng {n_samples}, thực tế: {aec_double.last_double_talk_count}"
        weights_norm_double = float(np.linalg.norm(aec_double.last_filter_weights))
        assert weights_norm_double == 0.0, "Bộ lọc phải đóng băng hoàn toàn trọng số!"
        print(f"  * [Double-talk] DTD Count: {aec_double.last_double_talk_count}/{n_samples} (Khẳng định 100% chính xác)")

        # 6. Bảo toàn năng lượng
        with wave.open(out_double, "rb") as wf:
            out_frames = wf.getnframes()
            out_bytes = wf.readframes(out_frames)
            out_samples = struct.unpack(f"<{out_frames}h", out_bytes)
        assert out_frames == n_samples
        out_rms = math.sqrt(sum(s * s for s in out_samples) / out_frames)
        assert out_rms > 5000.0
        print(f"  * [Double-talk] RMS giữ lại: {out_rms:.2f} > 5000.0")
        print("  --> [PASS] Nghiệm thu Test 9: Khẳng định chính xác 16.000/16.000 mẫu bị đóng băng!")
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def run_all_pipeline_tests():
    test_pipeline_full_flow()
    test_pipeline_bypass_aec()
    test_pipeline_validation_failure()
    test_pipeline_silence_detection()
    test_pipeline_clipping_gate()
    test_pipeline_downstream_chunker()
    test_quality_check_invalid_bit_depth()
    test_pipeline_cleanup_oserror_warning()
    test_aec_geigel_dtd_double_talk_protection()


if __name__ == "__main__":
    print("=" * 80)
    print(">>> BẮT ĐẦU KIỂM THỬ AUDIO PIPELINE & QUALITY CHECK (POST-AUDIT 100/100 SUITE) <<<")
    print("=" * 80)
    run_all_pipeline_tests()
    print("=" * 80)
    print(">>> KẾT THÚC BÀI KIỂM THỬ: TẤT CẢ 9/9 CA KIỂM THỬ ĐẠT 100% TIÊU CHUẨN PIPE! <<<")
    print("=" * 80)
