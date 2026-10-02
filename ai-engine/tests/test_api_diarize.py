import os
import sys
import tempfile
import shutil
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.path_security import (
    validate_safe_read_path,
    validate_safe_write_path,
    get_project_root,
    get_smartrec_temp_dir
)
from app.workers.tasks import diarize_audio_task


def create_dummy_wav(path: str):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(b"\x00\x00" * 1600)


def test_path_security_checks():
    smartrec_tmp = get_smartrec_temp_dir()
    test_dir = tempfile.mkdtemp(prefix="test_path_sec_", dir=str(smartrec_tmp))
    try:
        wav_path = os.path.join(test_dir, "test.wav")
        create_dummy_wav(wav_path)

        # 1. Đọc file WAV hợp lệ
        safe_read = validate_safe_read_path(wav_path)
        assert safe_read.exists()

        # 2. Đọc file không tồn tại -> FileNotFoundError
        try:
            validate_safe_read_path(os.path.join(test_dir, "non_existent.wav"))
            assert False, "Phải ném FileNotFoundError"
        except FileNotFoundError:
            pass

        # 3. Chặn đọc file source code
        root = get_project_root()
        source_py_file = str(root / "app" / "core" / "path_security.py")
        try:
            validate_safe_read_path(source_py_file)
            assert False, "Phải ném lỗi khi cố tình đọc file .py trong app/"
        except (PermissionError, ValueError):
            pass

        # 4. Chặn đọc file không phải định dạng audio
        non_audio_txt = os.path.join(test_dir, "secret.txt")
        Path(non_audio_txt).write_text("dummy_secret", encoding="utf-8")
        try:
            validate_safe_read_path(non_audio_txt)
            assert False, "Phải ném ValueError vì .txt không phải định dạng audio được phép"
        except ValueError as e:
            assert "không được hỗ trợ" in str(e)

        # 5. Ghi file JSON hợp lệ trong thư mục tạm chuyên biệt smartrec
        out_json = os.path.join(test_dir, "out.json")
        safe_write = validate_safe_write_path(out_json)
        assert safe_write == Path(out_json).resolve()

        # 6. Chặn ghi tự do ra ngoài temp hệ thống dùng chung (ví dụ trực tiếp dưới /tmp)
        system_tmp_file = "/tmp/arbitrary_hack.json"
        try:
            validate_safe_write_path(system_tmp_file)
            assert False, "Phải ném PermissionError khi ghi ra ngoài thư mục smartrec temp"
        except PermissionError:
            pass

        # 7. Chặn ghi đè vào source code app/
        malicious_code_path = str(root / "app" / "malicious.json")
        try:
            validate_safe_write_path(malicious_code_path)
            assert False, "Phải ném PermissionError khi cố ghi vào app/"
        except PermissionError:
            pass

        # 8. Chặn null byte injection
        try:
            validate_safe_write_path(f"{test_dir}/out\x00.json")
            assert False, "Phải ném ValueError khi có null byte"
        except ValueError:
            pass
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_celery_worker_path_security():
    smartrec_tmp = get_smartrec_temp_dir()
    test_dir = tempfile.mkdtemp(prefix="test_worker_sec_", dir=str(smartrec_tmp))
    try:
        wav_path = os.path.join(test_dir, "sample.wav")
        create_dummy_wav(wav_path)
        root = get_project_root()

        target_py_file = str(root / "app" / "api" / "routes.py")
        try:
            diarize_audio_task(audio_path=wav_path, output_json_path=target_py_file)
            assert False, "Worker phải chặn việc ghi đè vào routes.py"
        except PermissionError:
            pass

        malicious_read_file = str(root / "app" / "core" / "path_security.py")
        try:
            diarize_audio_task(audio_path=malicious_read_file)
            assert False, "Worker phải chặn việc đọc source code"
        except (PermissionError, ValueError):
            pass

    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def run_all_api_and_worker_tests():
    test_path_security_checks()
    test_celery_worker_path_security()


if __name__ == "__main__":
    run_all_api_and_worker_tests()
    print("ALL_API_AND_WORKER_SECURITY_TESTS_EXECUTED_SUCCESSFULLY")
