import os
import sys
import wave
import json
import struct
import tempfile
from pathlib import Path
from typing import Dict, Any, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pipelines.contracts import (
    AudioStage,
    PipelineStatus,
    PipelineJobContext,
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
from app.pipelines.audio_pipeline import (
    InputValidationStage,
    FFmpegStage,
    WebRTCStage,
    PyannoteStage,
    AudioPipelineOrchestrator,
    compute_file_sha256,
    compute_stage_fingerprint,
    _save_artifact_meta,
)


def _create_mock_wav(file_path: Path, sample_rate: int = 16000, channels: int = 1, duration_sec: float = 1.0):
    """Helper tạo file WAV chuẩn PCM 16-bit phục vụ kiểm thử."""
    with wave.open(str(file_path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        total_samples = int(sample_rate * duration_sec * channels)
        frames = struct.pack(f"<{total_samples}h", *([120] * total_samples))
        wf.writeframes(frames)


# ======================================================================
# 1. FUNCTIONAL TESTS CHO TỪNG STAGE
# ======================================================================

def test_input_validation_edge_cases():
    """Kiểm tra Stage 1 bắt lỗi: file không tồn tại, file rỗng, sai định dạng."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"

        # 1. File không tồn tại
        ctx_not_found = PipelineJobContext(
            job_id="JOB-VAL-01", media_id="MED-01",
            file_location=str(tmp_path / "missing.wav"),
            file_type="audio/wav", work_dir=work_dir
        )
        try:
            InputValidationStage().process(ctx_not_found)
            assert False
        except InputValidationError as e:
            assert "không tồn tại" in str(e)
            assert e.job_id == "JOB-VAL-01"

        # 2. File rỗng 0 bytes
        empty_file = tmp_path / "empty.wav"
        empty_file.touch()
        ctx_empty = PipelineJobContext(
            job_id="JOB-VAL-02", media_id="MED-02",
            file_location=str(empty_file),
            file_type="audio/wav", work_dir=work_dir
        )
        try:
            InputValidationStage().process(ctx_empty)
            assert False
        except InputValidationError as e:
            assert "0 bytes" in str(e)

        # 3. File sai định dạng không hỗ trợ
        bad_file = tmp_path / "script.txt"
        bad_file.write_text("not an audio")
        ctx_bad = PipelineJobContext(
            job_id="JOB-VAL-03", media_id="MED-03",
            file_location=str(bad_file),
            file_type="text/plain", work_dir=work_dir
        )
        try:
            InputValidationStage().process(ctx_bad)
            assert False
        except InputValidationError as e:
            assert "không nằm trong danh sách hỗ trợ" in str(e)


def test_ffmpeg_stage_and_corrupt_duration_error():
    """Kiểm tra Stage 2 chuẩn hóa audio và bắt lỗi khi file WAV hỏng, không nuốt lỗi thành duration 0."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"

        stereo_wav = tmp_path / "stereo_44k.wav"
        _create_mock_wav(stereo_wav, sample_rate=44100, channels=2, duration_sec=1.5)

        ctx = PipelineJobContext(
            job_id="JOB-FF-01", media_id="MED-FF",
            file_location=str(stereo_wav),
            file_type="audio/wav", work_dir=work_dir
        )

        stage = FFmpegStage()
        res = stage.process(ctx, str(stereo_wav), fingerprint="test-fp")
        assert res.success
        assert res.metadata["sample_rate"] == 16000
        assert res.metadata["channels"] == 1
        assert res.metadata["duration"] >= 1.4

        # Bắt lỗi khi output WAV bị hỏng header
        corrupt_wav = tmp_path / "corrupt.wav"
        corrupt_wav.write_bytes(b"RIFF____WAVEfmt NOT_A_REAL_WAV_HEADER_DATA")
        try:
            stage._extract_wav_duration(corrupt_wav, job_id="JOB-CORRUPT")
            assert False
        except FFmpegStageError as fe:
            assert fe.job_id == "JOB-CORRUPT"


def test_webrtc_truncates_padded_last_frame():
    """
    Kiểm chứng WebRTCStage cắt bỏ phần đệm zero-padding ở khung cuối cùng:
    Tạo audio có số mẫu không chia hết cho 20ms và 30ms.
    WAV đầu ra phải giữ chính xác từng frame âm thanh và thời lượng.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"

        # 16240 samples (1.015s ở 16kHz) -> không chia hết cho 480 samples (30ms) hay 320 samples (20ms)
        sample_count = 16240
        input_wav = tmp_path / "unaligned.wav"
        with wave.open(str(input_wav), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(struct.pack(f"<{sample_count}h", *([150] * sample_count)))

        ctx = PipelineJobContext(
            job_id="JOB-UNALIGNED", media_id="MED-UNALIGNED",
            file_location=str(input_wav),
            file_type="audio/wav", work_dir=work_dir
        )

        # Chạy với frame 30ms (480 samples)
        stage_30 = WebRTCStage(frame_duration_ms=30, processor_fn=lambda fb: fb)
        res_30 = stage_30.process(ctx, str(input_wav), fingerprint="fp-unaligned")
        assert res_30.success

        with wave.open(res_30.output_path, "rb") as wf_out:
            assert wf_out.getnframes() == sample_count, f"Số frame phải đúng bằng {sample_count}, không được dư padding"
            assert round(wf_out.getnframes() / 16000.0, 3) == 1.015

        # Kiểm tra tính toàn vẹn của manifest
        meta_file = Path(res_30.output_path).with_suffix(".wav.meta.json")
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        assert meta["duration"] == 1.015
        assert meta["size_bytes"] == Path(res_30.output_path).stat().st_size
        assert meta["checksum_sha256"] == compute_file_sha256(Path(res_30.output_path))


def test_webrtc_config_consistency_and_subchunking():
    """
    Kiểm tra đồng bộ cấu hình frame duration trong WebRTCStage:
    1. Injected processor không truyền duration -> get_config() và runtime đều là 30ms.
    2. Backend mặc định AudioANSService -> get_config() và runtime đều là 10ms.
    3. Backend AudioANSService với cấu hình 20ms và 30ms -> tự động chia sub-frames 10ms và xử lý thành công.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        valid_wav = tmp_path / "test_16k.wav"
        _create_mock_wav(valid_wav, sample_rate=16000, channels=1, duration_sec=1.0)

        ctx = PipelineJobContext(
            job_id="JOB-WEB-CFG", media_id="MED-CFG",
            file_location=str(valid_wav),
            file_type="audio/wav", work_dir=work_dir
        )

        # 1. Injected processor không truyền duration
        received_frame_lengths = []
        def spy_processor(fb: bytes) -> bytes:
            received_frame_lengths.append(len(fb))
            return fb

        stage_injected = WebRTCStage(processor_fn=spy_processor, processor_cache_key="spy:v1")
        assert stage_injected.get_config()["frame_duration_ms"] == 30
        res_inj = stage_injected.process(ctx, str(valid_wav), fingerprint="fp-inj")
        assert res_inj.success
        assert res_inj.metadata["frame_duration_ms"] == 30
        assert all(l == 960 for l in received_frame_lengths)

        # 2. AudioANSService với cấu hình 20ms và 30ms (sub-chunking sang 10ms)
        class MockAPMService:
            def __init__(self):
                self.FRAME_DURATION_MS = 10
                self.subframe_calls = 0

            def _create_processor(self, suppression_level: int = 2):
                return "proc"

            def _process_frame(self, proc, frame_bytes: bytes) -> bytes:
                self.subframe_calls += 1
                assert len(frame_bytes) == 320, "APM chỉ được nhận đúng 320 bytes (10ms)"
                return frame_bytes

        mock_apm = MockAPMService()
        saved_module = sys.modules.get("app.services.audio_ans")
        import types
        fake_module = types.ModuleType("app.services.audio_ans")
        fake_module.AudioANSService = lambda: mock_apm
        sys.modules["app.services.audio_ans"] = fake_module

        try:
            stage_20ms = WebRTCStage(frame_duration_ms=20)
            assert stage_20ms.get_config()["frame_duration_ms"] == 20
            res_20 = stage_20ms.process(ctx, str(valid_wav), fingerprint="fp-20ms")
            assert res_20.success
            assert res_20.metadata["frame_duration_ms"] == 20
            assert mock_apm.subframe_calls == 100

            mock_apm.subframe_calls = 0
            stage_30ms = WebRTCStage(frame_duration_ms=30)
            assert stage_30ms.get_config()["frame_duration_ms"] == 30
            res_30 = stage_30ms.process(ctx, str(valid_wav), fingerprint="fp-30ms")
            assert res_30.success
            assert mock_apm.subframe_calls >= 100
        finally:
            if saved_module is not None:
                sys.modules["app.services.audio_ans"] = saved_module
            else:
                sys.modules.pop("app.services.audio_ans", None)


def test_webrtc_stage_default_resolver_with_audio_ans_service():
    """Kiểm tra Stage 3 WebRTC resolver mặc định tích hợp trực tiếp với AudioANSService thực tế."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        valid_wav = tmp_path / "norm_16k.wav"
        _create_mock_wav(valid_wav, sample_rate=16000, channels=1, duration_sec=1.0)

        ctx = PipelineJobContext(
            job_id="JOB-WEB-RES", media_id="MED-RES",
            file_location=str(valid_wav),
            file_type="audio/wav", work_dir=work_dir
        )

        stage_real = WebRTCStage(processor_fn=None)
        res_real = stage_real.process(ctx, str(valid_wav), fingerprint="web-real-fp")
        assert res_real.success
        assert res_real.metadata["frame_duration_ms"] == 10
        assert Path(res_real.output_path).exists()


def test_webrtc_stage_missing_or_failing_backend():
    """Kiểm tra WebRTC ném WebRTCStageError rõ ràng khi backend lỗi hoặc không thể import."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        valid_wav = tmp_path / "norm_16k.wav"
        _create_mock_wav(valid_wav, sample_rate=16000, channels=1, duration_sec=0.5)

        ctx = PipelineJobContext(
            job_id="JOB-WEB-FAIL", media_id="MED-FAIL",
            file_location=str(valid_wav),
            file_type="audio/wav", work_dir=work_dir
        )

        saved_module = sys.modules.get("app.services.audio_ans")

        # 1. Giả lập module hoàn toàn không tồn tại
        try:
            sys.modules["app.services.audio_ans"] = None
            stage_no_backend = WebRTCStage(processor_fn=None)
            try:
                stage_no_backend.process(ctx, str(valid_wav))
                assert False
            except WebRTCStageError as we:
                assert "Không thể tìm thấy AudioANSService" in str(we)
                assert we.job_id == "JOB-WEB-FAIL"
        finally:
            if saved_module is not None:
                sys.modules["app.services.audio_ans"] = saved_module
            else:
                sys.modules.pop("app.services.audio_ans", None)

        # 2. Khởi tạo service ném lỗi
        import types
        failing_module = types.ModuleType("app.services.audio_ans")
        def crash_init(): raise RuntimeError("Missing C++ APM dynamic library")
        failing_module.AudioANSService = crash_init
        sys.modules["app.services.audio_ans"] = failing_module

        try:
            stage_fail_init = WebRTCStage(processor_fn=None)
            stage_fail_init.process(ctx, str(valid_wav))
            assert False
        except WebRTCStageError as we:
            assert "Missing C++ APM dynamic library" in str(we)
            assert we.job_id == "JOB-WEB-FAIL"
        finally:
            if saved_module is not None:
                sys.modules["app.services.audio_ans"] = saved_module
            else:
                sys.modules.pop("app.services.audio_ans", None)


def test_webrtc_processor_cache_key_invalidation_and_non_cacheable():
    """
    Kiểm tra tính năng cache key và an toàn cache của processor:
    1. Cùng processor_cache_key -> Cache WebRTC được reuse khi retry.
    2. Đổi processor_cache_key -> Cache WebRTC bị vô hiệu, buộc chạy lại.
    3. Injected processor KHÔNG có processor_cache_key -> non_cacheable: True, không bao giờ reuse.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        media_input = tmp_path / "meeting_key.wav"
        _create_mock_wav(media_input, sample_rate=16000, channels=1, duration_sec=1.0)

        ctx = PipelineJobContext(
            job_id="JOB-KEY-01", media_id="MED-KEY",
            file_location=str(media_input),
            file_type="audio/wav", work_dir=work_dir
        )

        webrtc_calls = 0
        def counting_proc(fb: bytes) -> bytes:
            nonlocal webrtc_calls
            webrtc_calls += 1
            return fb

        # 1. Pipeline với processor có key 'proc:v1'
        orch_v1 = AudioPipelineOrchestrator(
            webrtc_stage=WebRTCStage(processor_fn=counting_proc, processor_cache_key="noise-suppressor:v1:level-2"),
            pyannote_stage=PyannoteStage(diarizer_fn=lambda w: [{"speaker": "S1", "start": 0, "end": 1}])
        )
        out1 = orch_v1.run(ctx)
        assert out1.status == PipelineStatus.SUCCESS.value
        initial_calls = webrtc_calls
        assert initial_calls > 0

        # Retry với cùng key -> WebRTC artifact được reuse (không gọi thêm processor)
        out1_retry = orch_v1.run(ctx, start_from_stage=AudioStage.PYANNOTE)
        assert out1_retry.status == PipelineStatus.SUCCESS.value
        assert webrtc_calls == initial_calls, "WebRTC phải được reuse khi processor_cache_key khớp"

        # 2. Pipeline thay đổi key sang 'proc:v2' -> Cache cũ bị vô hiệu, buộc chạy lại
        orch_v2 = AudioPipelineOrchestrator(
            webrtc_stage=WebRTCStage(processor_fn=counting_proc, processor_cache_key="noise-suppressor:v2:level-2"),
            pyannote_stage=PyannoteStage(diarizer_fn=lambda w: [{"speaker": "S1", "start": 0, "end": 1}])
        )
        out2 = orch_v2.run(ctx, start_from_stage=AudioStage.PYANNOTE)
        assert out2.status == PipelineStatus.SUCCESS.value
        assert webrtc_calls > initial_calls, "WebRTC PHẢI chạy lại khi processor_cache_key thay đổi"

        # 3. Pipeline với processor KHÔNG có key -> non_cacheable -> không được reuse
        calls_before_anon = webrtc_calls
        orch_anon = AudioPipelineOrchestrator(
            webrtc_stage=WebRTCStage(processor_fn=counting_proc, processor_cache_key=None),
            pyannote_stage=PyannoteStage(diarizer_fn=lambda w: [{"speaker": "S1", "start": 0, "end": 1}])
        )
        out_anon1 = orch_anon.run(ctx, start_from_stage=AudioStage.PYANNOTE)
        assert out_anon1.status == PipelineStatus.SUCCESS.value
        calls_after_anon1 = webrtc_calls
        assert calls_after_anon1 > calls_before_anon

        out_anon2 = orch_anon.run(ctx, start_from_stage=AudioStage.PYANNOTE)
        assert out_anon2.status == PipelineStatus.SUCCESS.value
        assert webrtc_calls > calls_after_anon1, "Processor không có key tuyệt đối KHÔNG được reuse cache"


def test_pyannote_stage_fail_stop_and_no_dummy_fallback():
    """Kiểm chứng PyannoteStage ném lỗi PyannoteStageError và TUYỆT ĐỐI không fallback ra segments giả."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        clean_wav = tmp_path / "clean.wav"
        _create_mock_wav(clean_wav)

        ctx = PipelineJobContext(
            job_id="JOB-PY-01", media_id="MED-PY",
            file_location=str(clean_wav),
            file_type="audio/wav", work_dir=work_dir
        )

        def failing_diarizer(wav):
            raise RuntimeError("CUDA Out of Memory in pretrained pyannote")

        stage_fail = PyannoteStage(diarizer_fn=failing_diarizer)
        try:
            stage_fail.process(ctx, str(clean_wav))
            assert False
        except PyannoteStageError as pe:
            assert "CUDA Out of Memory" in str(pe)
            assert pe.job_id == "JOB-PY-01"


# ======================================================================
# 2. PIPELINE ORCHESTRATOR TESTS: TIMING, STAGE IDENTITY & MANIFEST ERRORS
# ======================================================================

def test_pipeline_execution_order_and_output_generation_timing():
    """Kiểm tra thứ tự tuần tự, đo lường thời gian OUTPUT_GENERATION và cấu trúc JSON output."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        media_input = tmp_path / "meeting_input.wav"
        _create_mock_wav(media_input, sample_rate=16000, channels=1, duration_sec=1.5)

        execution_order = []

        class TrackedInput(InputValidationStage):
            def process(self, ctx):
                execution_order.append(AudioStage.INPUT_VALIDATION)
                return super().process(ctx)

        class TrackedFFmpeg(FFmpegStage):
            def process(self, ctx, inp, fingerprint=None):
                execution_order.append(AudioStage.FFMPEG)
                return super().process(ctx, inp, fingerprint=fingerprint)

        class TrackedWebRTC(WebRTCStage):
            def process(self, ctx, inp, fingerprint=None):
                execution_order.append(AudioStage.WEBRTC)
                return super().process(ctx, inp, fingerprint=fingerprint)

        class TrackedPyannote(PyannoteStage):
            def process(self, ctx, inp):
                execution_order.append(AudioStage.PYANNOTE)
                return super().process(ctx, inp)

        orchestrator = AudioPipelineOrchestrator(
            input_stage=TrackedInput(),
            ffmpeg_stage=TrackedFFmpeg(),
            webrtc_stage=TrackedWebRTC(processor_fn=lambda f: f, processor_cache_key="key-timing"),
            pyannote_stage=TrackedPyannote(diarizer_fn=lambda w: [{"speaker": "S1", "start": 0.0, "end": 1.2}]),
        )

        ctx = PipelineJobContext(
            job_id="JOB-ORD-01", media_id="MED-ORD",
            file_location=str(media_input),
            file_type="audio/wav", work_dir=work_dir
        )

        output = orchestrator.run(ctx)

        assert execution_order == [
            AudioStage.INPUT_VALIDATION,
            AudioStage.FFMPEG,
            AudioStage.WEBRTC,
            AudioStage.PYANNOTE,
        ]

        times = output.stage_execution_times
        assert AudioStage.OUTPUT_GENERATION.value in times
        assert times[AudioStage.OUTPUT_GENERATION.value] >= 0.0

        out_dict = output.to_dict()
        assert out_dict["status"] == PipelineStatus.SUCCESS.value
        assert len(out_dict["segments"]) == 1
        assert out_dict["segments"][0]["speaker"] == "S1"


def test_pipeline_explicit_stage_result_success_check():
    """Kiểm tra Orchestrator dừng ngay lập tức khi một stage trả về StageResult(success=False)."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        media_input = tmp_path / "input.wav"
        _create_mock_wav(media_input)

        class BogusFFmpegStage(FFmpegStage):
            def process(self, ctx, inp, fingerprint=None):
                return StageResult(
                    stage=AudioStage.FFMPEG,
                    success=False,
                    error_message="Subprocess silently returned code 1"
                )

        pyannote_called = False
        def spy_diarizer(w):
            nonlocal pyannote_called
            pyannote_called = True
            return []

        orchestrator = AudioPipelineOrchestrator(
            ffmpeg_stage=BogusFFmpegStage(),
            webrtc_stage=WebRTCStage(processor_fn=lambda f: f, processor_cache_key="key-bogus"),
            pyannote_stage=PyannoteStage(diarizer_fn=spy_diarizer)
        )

        ctx = PipelineJobContext(
            job_id="JOB-BOGUS-01", media_id="MED-BOGUS",
            file_location=str(media_input),
            file_type="audio/wav", work_dir=work_dir
        )

        try:
            orchestrator.run(ctx)
            assert False
        except FFmpegStageError as fe:
            assert "Subprocess silently returned code 1" in str(fe)
            assert not pyannote_called


def test_pipeline_stage_identity_check():
    """Kiểm tra thứ tự stage và bắt lỗi khi StageResult trả về sai định danh stage."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        media_input = tmp_path / "input.wav"
        _create_mock_wav(media_input, sample_rate=16000, channels=1, duration_sec=1.0)

        class WrongStageFFmpeg(FFmpegStage):
            def process(self, ctx, inp, fingerprint=None):
                return StageResult(
                    stage=AudioStage.PYANNOTE,
                    success=True,
                    output_path=inp
                )

        orchestrator_wrong = AudioPipelineOrchestrator(ffmpeg_stage=WrongStageFFmpeg())
        ctx = PipelineJobContext(
            job_id="JOB-WRONG-STAGE", media_id="MED-WRONG",
            file_location=str(media_input),
            file_type="audio/wav", work_dir=work_dir
        )

        try:
            orchestrator_wrong.run(ctx)
            assert False
        except FFmpegStageError as fe:
            assert "Sai định danh stage: mong đợi 'FFMPEG'" in str(fe)


def test_output_generation_error_wrapping():
    """Kiểm tra ném OutputGenerationError khi dữ liệu segments hoặc duration không hợp lệ."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        media_input = tmp_path / "input.wav"
        _create_mock_wav(media_input)

        class BadSegmentPyannote(PyannoteStage):
            def process(self, ctx, inp):
                return StageResult(
                    stage=AudioStage.PYANNOTE,
                    success=True,
                    metadata={"segments": [{"speaker": "S1", "start": float("nan"), "end": 2.0}]}
                )

        orchestrator = AudioPipelineOrchestrator(
            webrtc_stage=WebRTCStage(processor_fn=lambda f: f, processor_cache_key="key-out-err"),
            pyannote_stage=BadSegmentPyannote()
        )

        ctx = PipelineJobContext(
            job_id="JOB-OUT-ERR", media_id="MED-ERR",
            file_location=str(media_input),
            file_type="audio/wav", work_dir=work_dir
        )

        try:
            orchestrator.run(ctx)
            assert False
        except OutputGenerationError as oe:
            assert oe.stage == AudioStage.OUTPUT_GENERATION.value
            assert oe.job_id == "JOB-OUT-ERR"


def test_manifest_write_failure_wrapping():
    """Kiểm tra lỗi ghi manifest được bọc chuẩn xác thành exception của stage tương ứng."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        media_input = tmp_path / "input.wav"
        _create_mock_wav(media_input)

        ctx = PipelineJobContext(
            job_id="JOB-MANIFEST-ERR", media_id="MED-MAN",
            file_location=str(media_input),
            file_type="audio/wav", work_dir=work_dir
        )

        ffmpeg_stage = FFmpegStage()
        original_replace = Path.replace
        try:
            def broken_replace(self, target):
                if ".meta.json" in str(target):
                    raise OSError("Simulated Disk Full (No space left on device)")
                return original_replace(self, target)

            Path.replace = broken_replace

            try:
                ffmpeg_stage.process(ctx, str(media_input), fingerprint="fake-fp")
                assert False
            except FFmpegStageError as fe:
                assert "Không thể ghi manifest metadata cho artifact FFmpeg" in str(fe)
                assert isinstance(fe.__cause__, OSError)
        finally:
            Path.replace = original_replace


def test_webrtc_cache_invalidation_on_ffmpeg_output_change():
    """
    Kiểm chứng Artifact Lineage Chaining:
    WebRTC cache phụ thuộc trực tiếp vào đầu ra của FFmpeg.
    Nếu nội dung FFmpeg WAV thay đổi -> WebRTC cache bị vô hiệu và buộc phải chạy lại.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        media_input = tmp_path / "meeting_chain.wav"
        _create_mock_wav(media_input, sample_rate=16000, channels=1, duration_sec=1.0)

        ctx = PipelineJobContext(
            job_id="JOB-CHAIN-01", media_id="MED-CHAIN",
            file_location=str(media_input),
            file_type="audio/wav", work_dir=work_dir
        )

        webrtc_runs = 0
        class CountingWebRTC(WebRTCStage):
            def process(self, ctx, inp, fingerprint=None):
                nonlocal webrtc_runs
                webrtc_runs += 1
                return super().process(ctx, inp, fingerprint=fingerprint)

        orch = AudioPipelineOrchestrator(
            webrtc_stage=CountingWebRTC(processor_fn=lambda f: f, processor_cache_key="test-chain-key"),
            pyannote_stage=PyannoteStage(diarizer_fn=lambda w: [{"speaker": "S1", "start": 0, "end": 1}])
        )

        out1 = orch.run(ctx)
        assert out1.status == PipelineStatus.SUCCESS.value
        assert webrtc_runs == 1

        out2 = orch.run(ctx, start_from_stage=AudioStage.PYANNOTE)
        assert out2.status == PipelineStatus.SUCCESS.value
        assert webrtc_runs == 1

        # Sửa đổi nội dung file WAV của FFmpeg artifact
        ffmpeg_file = work_dir / f"ffmpeg_{ctx.job_id}.wav"
        with open(ffmpeg_file, "r+b") as wf_mod:
            wf_mod.seek(120)
            wf_mod.write(b"\x55\xaa\x55\xaa")

        new_ffmpeg_hash = compute_file_sha256(ffmpeg_file)
        meta_file = ffmpeg_file.with_suffix(ffmpeg_file.suffix + ".meta.json")
        meta_json = json.loads(meta_file.read_text(encoding="utf-8"))
        meta_json["checksum_sha256"] = new_ffmpeg_hash
        meta_file.write_text(json.dumps(meta_json), encoding="utf-8")

        # Khi retry: Đầu ra FFmpeg đổi SHA-256 -> WebRTC PHẢI chạy lại
        out3 = orch.run(ctx, start_from_stage=AudioStage.PYANNOTE)
        assert out3.status == PipelineStatus.SUCCESS.value
        assert webrtc_runs == 2, "WebRTC PHẢI chạy lại khi nội dung đầu ra của FFmpeg thay đổi"


def test_advanced_retry_cache_validation():
    """
    Kiểm tra bảo mật và toàn vẹn cache:
    1. Thay đổi nội dung input nhưng giữ nguyên size và mtime -> Phải chạy lại stage!
    2. Sửa đổi nội dung WAV (lệch checksum) dù vẫn giữ header WAV hợp lệ -> Phải chạy lại stage!
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        work_dir = tmp_path / "work"
        media_input = tmp_path / "input.wav"
        _create_mock_wav(media_input, sample_rate=16000, channels=1, duration_sec=1.0)

        ctx = PipelineJobContext(
            job_id="JOB-CACHE-ADV", media_id="MED-CACHE",
            file_location=str(media_input),
            file_type="audio/wav", work_dir=work_dir
        )

        ffmpeg_runs = 0
        class CountingFFmpeg(FFmpegStage):
            def process(self, ctx, inp, fingerprint=None):
                nonlocal ffmpeg_runs
                ffmpeg_runs += 1
                return super().process(ctx, inp, fingerprint=fingerprint)

        orch1 = AudioPipelineOrchestrator(
            ffmpeg_stage=CountingFFmpeg(),
            webrtc_stage=WebRTCStage(processor_fn=lambda f: f, processor_cache_key="key-adv"),
            pyannote_stage=PyannoteStage(diarizer_fn=lambda w: [{"speaker": "S1", "start": 0, "end": 1}])
        )

        out1 = orch1.run(ctx)
        assert out1.status == PipelineStatus.SUCCESS.value
        assert ffmpeg_runs == 1

        orig_stat = media_input.stat()
        raw_bytes = bytearray(media_input.read_bytes())
        raw_bytes[100] = (raw_bytes[100] + 1) % 256
        media_input.write_bytes(raw_bytes)
        os.utime(media_input, (orig_stat.st_atime, orig_stat.st_mtime))

        out2 = orch1.run(ctx, start_from_stage=AudioStage.WEBRTC)
        assert out2.status == PipelineStatus.SUCCESS.value
        assert ffmpeg_runs == 2, "FFmpeg PHẢI chạy lại vì nội dung input đã thay đổi (SHA-256 khác biệt)"


def run_all_tests():
    test_input_validation_edge_cases()
    test_ffmpeg_stage_and_corrupt_duration_error()
    test_webrtc_truncates_padded_last_frame()
    test_webrtc_config_consistency_and_subchunking()
    test_webrtc_stage_default_resolver_with_audio_ans_service()
    test_webrtc_stage_missing_or_failing_backend()
    test_webrtc_processor_cache_key_invalidation_and_non_cacheable()
    test_pyannote_stage_fail_stop_and_no_dummy_fallback()
    test_pipeline_execution_order_and_output_generation_timing()
    test_pipeline_explicit_stage_result_success_check()
    test_pipeline_stage_identity_check()
    test_output_generation_error_wrapping()
    test_manifest_write_failure_wrapping()
    test_webrtc_cache_invalidation_on_ffmpeg_output_change()
    test_advanced_retry_cache_validation()


if __name__ == "__main__":
    run_all_tests()
    print("ALL_ENHANCED_AUDIO_PIPELINE_TESTS_EXECUTED_SUCCESSFULLY")
