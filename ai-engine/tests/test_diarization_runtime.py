import os
import sys
import tempfile
import wave
import shutil
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import torch
import numpy as np
from pyannote.core import Annotation, Segment

from app.schemas.diarization_schemas import SpeakerSegment
from app.services.diarization_runtime import (
    DiarizationRuntimeManager,
    DiarizationTokenMissingError,
    DiarizationAccessDeniedError,
    DiarizationInferenceError,
    diarization_runtime
)


def create_mock_wav_file(file_path: str, duration_seconds: float = 1.0, sample_rate: int = 16000):
    num_frames = int(sample_rate * duration_seconds)
    with wave.open(file_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * num_frames)


def test_singleton_instance_identity():
    mgr1 = DiarizationRuntimeManager()
    mgr2 = DiarizationRuntimeManager()
    assert mgr1 is mgr2
    assert mgr1 is diarization_runtime


def test_device_resolution_logic():
    mgr = DiarizationRuntimeManager()
    assert mgr._resolve_target_device("cpu") == "cpu"

    with patch("torch.cuda.is_available", return_value=True):
        assert mgr._resolve_target_device(None) == "cuda"

    with patch("torch.cuda.is_available", return_value=False), \
         patch("torch.backends.mps.is_available", return_value=True):
        assert mgr._resolve_target_device(None) == "mps"

    with patch("torch.cuda.is_available", return_value=False), \
         patch("torch.backends.mps.is_available", return_value=False):
        assert mgr._resolve_target_device(None) == "cpu"


def test_missing_hf_token_raises_error():
    test_mgr = DiarizationRuntimeManager.__new__(DiarizationRuntimeManager)
    test_mgr._initialized = False
    test_mgr.__init__(hf_token=None)
    test_mgr.hf_token = ""
    test_mgr._pipeline = None

    try:
        test_mgr.load_pipeline()
        assert False, "Phải ném DiarizationTokenMissingError khi thiếu token"
    except DiarizationTokenMissingError as exc:
        assert "HF_TOKEN chưa được cấu hình" in str(exc)


def test_access_denied_token_error():
    test_mgr = DiarizationRuntimeManager.__new__(DiarizationRuntimeManager)
    test_mgr._initialized = False
    test_mgr.__init__(hf_token="hf_mock_invalid_token")
    test_mgr._pipeline = None

    with patch("pyannote.audio.Pipeline.from_pretrained", side_effect=Exception("401 Client Error: Unauthorized for url")):
        try:
            test_mgr.load_pipeline()
            assert False, "Phải ném DiarizationAccessDeniedError khi gặp lỗi 401"
        except DiarizationAccessDeniedError:
            pass


def test_device_fallback_to_cpu_on_error():
    test_mgr = DiarizationRuntimeManager.__new__(DiarizationRuntimeManager)
    test_mgr._initialized = False
    test_mgr.__init__(prefer_device="mps", hf_token="hf_mock_token")
    test_mgr._pipeline = None

    mock_pipeline = MagicMock()
    mock_pipeline.to.side_effect = [RuntimeError("MPS device error"), mock_pipeline]

    with patch("pyannote.audio.Pipeline.from_pretrained", return_value=mock_pipeline):
        loaded_pipeline = test_mgr.load_pipeline()
        assert test_mgr.device == "cpu"
        assert loaded_pipeline is mock_pipeline


def test_normalize_annotation_contract():
    """Kiểm chứng chuẩn hóa output về đúng Annotation contract."""
    test_mgr = DiarizationRuntimeManager.__new__(DiarizationRuntimeManager)
    test_mgr._initialized = False
    test_mgr.__init__(prefer_device="cpu", hf_token="hf_mock_token")

    # 1. Annotation trực tiếp
    ann = Annotation()
    assert test_mgr._normalize_annotation(ann) is ann

    # 2. Đối tượng chứa thuộc tính speaker_diarization
    class MockDiarizeOutput:
        def __init__(self, annotation):
            self.speaker_diarization = annotation

    wrapper_obj = MockDiarizeOutput(ann)
    assert test_mgr._normalize_annotation(wrapper_obj) is ann

    # 3. Output sai kiểu
    try:
        test_mgr._normalize_annotation({"invalid": "type"})
        assert False, "Phải ném DiarizationInferenceError khi output không đúng kiểu Annotation"
    except DiarizationInferenceError as err:
        assert "Kỳ vọng kiểu 'pyannote.core.Annotation'" in str(err)


def test_inference_mps_error_fallback_to_cpu():
    """Kiểm chứng Fallback về CPU khi inference trên MPS gặp lỗi tensor operator."""
    test_mgr = DiarizationRuntimeManager.__new__(DiarizationRuntimeManager)
    test_mgr._initialized = False
    test_mgr.__init__(prefer_device="mps", hf_token="hf_mock_token")
    test_mgr.device = "mps"

    mock_annotation = Annotation()
    mock_annotation[Segment(0.0, 2.0)] = "SPEAKER_00"

    mock_pipeline = MagicMock()
    mock_pipeline.side_effect = [RuntimeError("MPS tensor operator not implemented"), mock_annotation]
    test_mgr._pipeline = mock_pipeline

    res = test_mgr.diarize("dummy.wav")
    assert res is mock_annotation
    assert test_mgr.device == "cpu"
    mock_pipeline.to.assert_called_with(torch.device("cpu"))


def test_multithreaded_mps_fallback_safety():
    """Kiểm chứng bảo vệ model dùng chung trong môi trường đa luồng khi MPS fallback."""
    test_mgr = DiarizationRuntimeManager.__new__(DiarizationRuntimeManager)
    test_mgr._initialized = False
    test_mgr.__init__(prefer_device="mps", hf_token="hf_mock_token")
    test_mgr.device = "mps"

    mock_annotation = Annotation()
    mock_annotation[Segment(0.0, 1.0)] = "SPEAKER_00"

    mock_pipeline = MagicMock()
    # Thread đầu tiên gặp lỗi MPS và fallback sang CPU, các thread sau chạy an toàn trên CPU
    mock_pipeline.side_effect = [
        RuntimeError("MPS tensor operator error"),
        mock_annotation,
        mock_annotation,
        mock_annotation
    ]
    test_mgr._pipeline = mock_pipeline

    results = []
    errors = []

    def worker():
        try:
            r = test_mgr.diarize("dummy.wav")
            results.append(r)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 0, f"Có lỗi xảy ra trong các thread: {errors}"
    assert len(results) == 3
    assert test_mgr.device == "cpu"


def test_extract_speaker_embeddings_with_zero_timestamp_pydantic():
    """
    Kiểm chứng xử lý đối tượng Pydantic SpeakerSegment có start_seconds == 0.0s.
    Không bị lỗi falsy và hỗ trợ cả Tensor output.
    """
    test_dir = tempfile.mkdtemp(prefix="test_emb_pydantic_")
    try:
        wav_path = os.path.join(test_dir, "test.wav")
        create_mock_wav_file(wav_path, duration_seconds=3.0)

        test_mgr = DiarizationRuntimeManager.__new__(DiarizationRuntimeManager)
        test_mgr._initialized = False
        test_mgr.__init__(prefer_device="cpu", hf_token="hf_mock_token")

        # Mock model trả về PyTorch Tensor thay vì ndarray
        mock_embedding_model = MagicMock()
        mock_embedding_model.return_value = torch.ones((1, 256), dtype=torch.float32)

        mock_pipeline = MagicMock()
        mock_pipeline._embedding = mock_embedding_model
        test_mgr._pipeline = mock_pipeline

        # Đối tượng Pydantic thực sự với start_seconds = 0.0
        pydantic_segment = SpeakerSegment(
            segment_id=1,
            speaker="SPEAKER_00",
            start_seconds=0.0,
            end_seconds=2.0,
            duration_seconds=2.0,
            start_time="00:00:00.000",
            end_time="00:00:02.000"
        )

        emb_map = test_mgr.extract_speaker_embeddings(wav_path, [pydantic_segment])
        assert "SPEAKER_00" in emb_map
        assert len(emb_map["SPEAKER_00"]) == 256
        assert emb_map["SPEAKER_00"][0] == 1.0
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_deterministic_offline_diarize_call():
    test_mgr = DiarizationRuntimeManager.__new__(DiarizationRuntimeManager)
    test_mgr._initialized = False
    test_mgr.__init__(prefer_device="cpu", hf_token="hf_mock_token")

    mock_annotation = Annotation()
    mock_annotation[Segment(0.0, 1.5)] = "SPEAKER_00"

    mock_pipeline = MagicMock()
    mock_pipeline.return_value = mock_annotation
    test_mgr._pipeline = mock_pipeline

    result = test_mgr.diarize("mock_sample.wav")
    assert isinstance(result, Annotation)
    assert len(list(result.itertracks())) == 1


def run_all_runtime_tests():
    test_singleton_instance_identity()
    test_device_resolution_logic()
    test_missing_hf_token_raises_error()
    test_access_denied_token_error()
    test_device_fallback_to_cpu_on_error()
    test_normalize_annotation_contract()
    test_inference_mps_error_fallback_to_cpu()
    test_multithreaded_mps_fallback_safety()
    test_extract_speaker_embeddings_with_zero_timestamp_pydantic()
    test_deterministic_offline_diarize_call()


if __name__ == "__main__":
    run_all_runtime_tests()
    print("ALL_DIARIZATION_RUNTIME_TESTS_EXECUTED_SUCCESSFULLY")
