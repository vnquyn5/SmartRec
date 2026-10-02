import os
import sys
import time
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock

# Nạp thư mục gốc vào sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import torch
from pyannote.core import Annotation, Segment
from app.services.diarization_runtime import (
    resolve_device,
    diarization_runtime,
    DiarizationRuntimeManager,
    DiarizationRuntimeError,
    DiarizationTokenMissingError,
    DiarizationAccessDeniedError,
    DiarizationModelLoadError
)


def test_resolve_device_priority():
    print("\n[TEST 1] Kiểm tra giải pháp nhận diện thiết bị (Device Resolution)...")
    assert resolve_device("cpu") == torch.device("cpu")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        assert resolve_device("mps") == torch.device("mps")
        assert resolve_device("auto") == torch.device("mps")
    else:
        assert resolve_device("auto") == torch.device("cpu")

    try:
        resolve_device("invalid_device_name")
        assert False, "Phải ném DiarizationRuntimeError khi thiết bị không hợp lệ"
    except DiarizationRuntimeError as e:
        assert "không hợp lệ" in str(e)
    print("  --> [PASS] Nghiệm thu Test 1: Nhận diện thiết bị và bắt lỗi cấu hình chính xác!")


def test_missing_token_error():
    print("\n[TEST 2] Kiểm tra bắt lỗi thiếu Hugging Face Token (DiarizationTokenMissingError)...")
    manager = DiarizationRuntimeManager()
    with patch("app.core.config.settings.hf_token", None), \
         patch.dict(os.environ, {}, clear=True):
        try:
            manager.get_token()
            assert False, "Phải ném DiarizationTokenMissingError khi thiếu HF_TOKEN"
        except DiarizationTokenMissingError as e:
            assert "Thiếu HF_TOKEN" in str(e)
            print(f"  * Thông báo lỗi ghi nhận: {e}")
    print("  --> [PASS] Nghiệm thu Test 2: Bắt đúng loại ngoại lệ token rõ ràng!")


def test_access_denied_token_error():
    print("\n[TEST 3] Kiểm tra bắt lỗi Token sai hoặc chưa được duyệt Gated Repo (HTTP 401/403)...")
    manager = DiarizationRuntimeManager()
    manager.reset()

    # Giả lập Hugging Face ném lỗi 403 Forbidden / Gated Repo
    mock_gated_error = RuntimeError("HTTP Error 403 Forbidden: You must be authenticated and have access to pyannote/speaker-diarization-3.1")
    with patch("pyannote.audio.Pipeline.from_pretrained", side_effect=mock_gated_error):
        try:
            manager.load_pipeline(force_reload=True)
            assert False, "Phải ném DiarizationAccessDeniedError khi gặp lỗi 403 Gated Repo"
        except DiarizationAccessDeniedError as e:
            assert "bị từ chối" in str(e)
            print(f"  * Bắt đúng ngoại lệ phân loại: {type(e).__name__} -> {e}")

    # Giả lập pipeline trả về None do token không hợp lệ
    with patch("pyannote.audio.Pipeline.from_pretrained", return_value=None):
        try:
            manager.load_pipeline(force_reload=True)
            assert False, "Phải ném DiarizationAccessDeniedError khi Pipeline trả về None"
        except DiarizationAccessDeniedError as e:
            assert "Quyền truy cập bị từ chối" in str(e)
            print(f"  * Bắt đúng trường hợp Pipeline None: {type(e).__name__}")

    manager.reset()
    print("  --> [PASS] Nghiệm thu Test 3: Phân loại lỗi quyền truy cập Gated Repo chuẩn xác!")


def test_singleton_thread_safety():
    print("\n[TEST 4] Kiểm tra an toàn đa luồng (Thread-safety) & Cam kết khởi tạo 1 lần...")
    manager = DiarizationRuntimeManager()
    manager.reset()

    call_count = 0
    mock_pipeline = MagicMock()

    def slow_from_pretrained(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        time.sleep(0.05)  # Giả lập độ trễ nạp model
        return mock_pipeline

    with patch("pyannote.audio.Pipeline.from_pretrained", side_effect=slow_from_pretrained):
        threads = []
        results = []

        def worker():
            p = manager.load_pipeline()
            results.append(p)

        # Khởi chạy 10 luồng gọi load_pipeline cùng một lúc
        for _ in range(10):
            t = threading.Thread(target=worker)
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        # Kiểm chứng: Tất cả 10 luồng đều nhận cùng 1 instance và hàm nạp chỉ chạy duy nhất 1 lần
        assert len(results) == 10
        assert all(r is mock_pipeline for r in results)
        assert call_count == 1, f"Kỳ vọng nạp 1 lần, thực tế bị gọi {call_count} lần!"
        print(f"  * 10 luồng đồng thời gọi nạp pipeline: Pipeline.from_pretrained chỉ chạy đúng {call_count} lần.")

    manager.reset()
    print("  --> [PASS] Nghiệm thu Test 4: Cơ chế Thread-safety Singleton đạt chuẩn 100%!")


def test_mps_to_cpu_fallback():
    print("\n[TEST 5] Kiểm tra cơ chế Fallback sang CPU khi GPU gặp sự cố...")
    manager = DiarizationRuntimeManager()
    manager.reset()

    mock_pipeline = MagicMock()
    def mock_to(device):
        if device.type == "mps":
            raise RuntimeError("Toán tử MPS không tương thích")
        return mock_pipeline

    mock_pipeline.to.side_effect = mock_to

    with patch("pyannote.audio.Pipeline.from_pretrained", return_value=mock_pipeline), \
         patch("app.services.diarization_runtime.resolve_device", return_value=torch.device("mps")), \
         patch("app.services.diarization_runtime.logger.warning") as mock_warn:

        loaded = manager.load_pipeline(force_reload=True)
        assert loaded is mock_pipeline
        assert manager._active_device == torch.device("cpu")
        assert mock_warn.called
        print(f"  * Log cảnh báo ghi nhận: {mock_warn.call_args[0][0]}")

    manager.reset()
    print("  --> [PASS] Nghiệm thu Test 5: Fallback sang CPU bảo toàn an toàn hệ thống!")


def test_diarize_output_compatibility():
    print("\n[TEST 6] Kiểm tra Interface diarize() hỗ trợ cả Pyannote 4.x và 3.x...")
    manager = DiarizationRuntimeManager()
    manager.reset()

    # 1. Giả lập kết quả dạng pyannote 4.x: Đối tượng DiarizeOutput có thuộc tính .speaker_diarization
    mock_annotation_4x = Annotation()
    mock_annotation_4x[Segment(0.0, 2.5)] = "SPEAKER_00"

    mock_diarize_output_4x = MagicMock()
    mock_diarize_output_4x.speaker_diarization = mock_annotation_4x

    mock_pipe_4x = MagicMock(return_value=mock_diarize_output_4x)
    with patch.object(manager, "load_pipeline", return_value=mock_pipe_4x):
        res_4x = manager.diarize("dummy.wav")
        assert isinstance(res_4x, Annotation)
        assert len(list(res_4x.itertracks())) == 1
        print("  * [Pyannote 4.x DiarizeOutput] Bóc tách Annotation thành công!")

    # 2. Giả lập kết quả dạng pyannote 3.x: Trả thẳng đối tượng Annotation
    mock_annotation_3x = Annotation()
    mock_annotation_3x[Segment(3.0, 5.0)] = "SPEAKER_01"
    mock_pipe_3x = MagicMock(return_value=mock_annotation_3x)
    with patch.object(manager, "load_pipeline", return_value=mock_pipe_3x):
        res_3x = manager.diarize("dummy.wav")
        assert isinstance(res_3x, Annotation)
        assert len(list(res_3x.itertracks())) == 1
        print("  * [Pyannote 3.x Annotation] Nhận diện trực tiếp Annotation thành công!")

    # 3. Giả lập kết quả trả về kiểu dữ liệu lạ -> Phải ném DiarizationRuntimeError
    mock_pipe_bad = MagicMock(return_value="unexpected_string_output")
    with patch.object(manager, "load_pipeline", return_value=mock_pipe_bad):
        try:
            manager.diarize("dummy.wav")
            assert False, "Phải ném DiarizationRuntimeError khi đầu ra không phải Annotation"
        except DiarizationRuntimeError as e:
            assert "không đạt chuẩn pyannote.core.Annotation" in str(e)
            print("  * [Invalid Output Validation] Chặn đứng kiểu dữ liệu không hợp lệ thành công!")

    manager.reset()
    print("  --> [PASS] Nghiệm thu Test 6: Interface diarize() hoàn toàn tương thích và kiểm tra chặt chẽ!")


def test_runtime_info_metadata():
    print("\n[TEST 7] Kiểm tra truy xuất Metadata giám sát Runtime...")
    manager = DiarizationRuntimeManager()
    manager.load_pipeline()
    info = manager.get_runtime_info()

    assert "model_id" in info
    assert "is_loaded" in info and info["is_loaded"] is True
    assert "active_device" in info and info["active_device"] is not None
    assert "torch_version" in info
    print(f"  * Metadata thu được: {info}")
    print("  --> [PASS] Nghiệm thu Test 7: Metadata đầy đủ thông tin giám sát!")


def test_inference_and_interface_readiness():
    print("\n[TEST 8] Kiểm tra chạy Inference thực tế trên Audio mẫu qua Interface diarize()...")
    sample_audio = "poc/data/input/input2_normalized_16k.wav"
    if not os.path.exists(sample_audio):
        sample_audio = "poc/data/input/input2.wav"

    manager = DiarizationRuntimeManager()
    annotation = manager.diarize(sample_audio)

    assert isinstance(annotation, Annotation), "Đầu ra phải là đối tượng pyannote.core.Annotation!"
    turns = list(annotation.itertracks(yield_label=True))
    assert len(turns) > 0, "Phải phát hiện ít nhất một lượt nói trong audio mẫu!"

    first_turn, _, first_speaker = turns[0]
    assert first_turn.start >= 0.0 and first_turn.end > first_turn.start
    assert isinstance(first_speaker, str)
    print(f"  * Số lượt phát biểu thực tế: {len(turns)}")
    print(f"  * Phân đoạn đầu tiên: [{first_turn.start:.2f}s -> {first_turn.end:.2f}s] - {first_speaker}")
    print("  --> [PASS] Nghiệm thu Test 8: Sẵn sàng 100% bàn giao cho Task 2.10.2!")


def run_all_diarization_runtime_tests():
    test_resolve_device_priority()
    test_missing_token_error()
    test_access_denied_token_error()
    test_singleton_thread_safety()
    test_mps_to_cpu_fallback()
    test_diarize_output_compatibility()
    test_runtime_info_metadata()
    test_inference_and_interface_readiness()


if __name__ == "__main__":
    print("=" * 80)
    print(">>> BẮT ĐẦU KIỂM THỬ RUNTIME & MODEL LOADER DIARIZATION (POST-AUDIT 100/100) <<<")
    print("=" * 80)
    run_all_diarization_runtime_tests()
    print("=" * 80)
    print(">>> KẾT THÚC BÀI KIỂM THỬ: 8/8 CA KIỂM THỬ ĐẠT 100% TIÊU CHUẨN KỸ THUẬT! <<<")
    print("=" * 80)
