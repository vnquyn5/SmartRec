import os
import sys
import time
import sqlite3
import subprocess
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.tracking.contracts import AIUsageRecord
from app.tracking.collector import ResourceCollector
from app.tracking.storage import AIUsageRepository
from app.tracking.tracker import ResourceTracker, _PeakMemoryMonitor


# ======================================================================
# 1. FUNCTIONAL TESTS (Job ID, Model, Version, Processing Time, Scope)
# ======================================================================

def test_successful_job_tracking():
    """Kiểm tra AI Job thành công. Ở scope='thread', CPU đo theo luồng và ram_usage=None."""
    repo = AIUsageRepository(db_path=":memory:")
    try:
        with ResourceTracker(
            job_id="JOB-SUCCESS-01",
            model_name="pyannote/speaker-diarization-3.1",
            model_version="3.1.0",
            repository=repo
        ) as tracker:
            time.sleep(0.05)

        record = tracker.record
        assert record is not None
        assert record.job_id == "JOB-SUCCESS-01"
        assert record.model_name == "pyannote/speaker-diarization-3.1"
        assert record.model_version == "3.1.0"
        assert record.status == "success"
        assert record.processing_time >= 0.04
        assert record.error_message is None
        assert record.measurement_scope == "thread"
        assert record.ram_usage is None

        saved_records = repo.get_by_job_id("JOB-SUCCESS-01")
        assert len(saved_records) == 1
        assert saved_records[0].job_id == "JOB-SUCCESS-01"
        assert saved_records[0].ram_usage is None
    finally:
        repo.close()


def test_invalid_tracker_arguments():
    """Kiểm tra khởi tạo ResourceTracker với đối số rỗng, sai kiểu hoặc scope không hợp lệ."""
    try:
        ResourceTracker(job_id="", model_name="m", model_version="1.0")
        assert False, "Phải ném ValueError khi job_id rỗng"
    except ValueError as e:
        assert "job_id" in str(e)

    try:
        ResourceTracker(job_id="J1", model_name="m", model_version="1.0", scope="cluster")
        assert False, "Phải ném ValueError khi scope không hợp lệ"
    except ValueError as e:
        assert "scope không hợp lệ" in str(e)

    try:
        ResourceTracker(job_id="J1", model_name="m", model_version="1.0", scope="process", target_pid=None)
        assert False, "Phải ném ValueError khi scope='process' mà target_pid là None"
    except ValueError as e:
        assert "target_pid" in str(e)

    try:
        ResourceTracker(job_id="J1", model_name="m", model_version="1.0", scope="process", target_pid=-99)
        assert False, "Phải ném ValueError khi target_pid âm"
    except ValueError as e:
        assert "target_pid" in str(e)


# ======================================================================
# 2. THREAD SCOPE VS PROCESS SCOPE ACCURACY & ISOLATION
# ======================================================================

def test_thread_scope_concurrent_jobs_ram_is_none():
    """Kiểm chứng hai job chạy đồng thời trong cùng process ở scope='thread': ram_usage=None."""
    repo = AIUsageRepository(db_path=":memory:")
    try:
        def worker(job_id: str):
            with ResourceTracker(job_id, "thread-model", "1.0", scope="thread", repository=repo):
                buf = bytearray(10 * 1024 * 1024)
                time.sleep(0.04)
                del buf

        t1 = threading.Thread(target=worker, args=("JOB-T1",))
        t2 = threading.Thread(target=worker, args=("JOB-T2",))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        rec1 = repo.get_latest_by_job_id("JOB-T1")
        rec2 = repo.get_latest_by_job_id("JOB-T2")
        assert rec1 is not None and rec2 is not None
        assert rec1.ram_usage is None
        assert rec2.ram_usage is None
    finally:
        repo.close()


def test_process_scope_ram_isolation_concurrent_processes():
    """Kiểm chứng cô lập RAM chính xác khi dùng scope='process' với PID riêng của worker."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_file = str(Path(tmp_dir) / "concurrent_jobs.db")

        script_job = f"""
import os, sys, time
from pathlib import Path
sys.path.insert(0, '{str(Path(__file__).resolve().parent.parent)}')
from app.tracking.storage import AIUsageRepository
from app.tracking.tracker import ResourceTracker

job_id = sys.argv[1]
alloc_mb = int(sys.argv[2])
repo = AIUsageRepository(db_path='{db_file}')

with ResourceTracker(
    job_id=job_id,
    model_name='test-model',
    model_version='1.0',
    scope='process',
    target_pid=os.getpid(),
    repository=repo
):
    time.sleep(0.05)
    buf = bytearray(alloc_mb * 1024 * 1024)
    time.sleep(0.06)
    del buf
repo.close()
"""
        python_bin = sys.executable
        p1 = subprocess.Popen([python_bin, "-c", script_job, "JOB-HEAVY", "60"])
        p2 = subprocess.Popen([python_bin, "-c", script_job, "JOB-LIGHT", "2"])

        p1.wait()
        p2.wait()
        assert p1.returncode == 0
        assert p2.returncode == 0

        repo_verify = AIUsageRepository(db_path=db_file)
        rec_heavy = repo_verify.get_latest_by_job_id("JOB-HEAVY")
        rec_light = repo_verify.get_latest_by_job_id("JOB-LIGHT")
        repo_verify.close()

        assert rec_heavy is not None
        assert rec_light is not None
        assert rec_heavy.ram_usage is not None and rec_heavy.ram_usage >= 30.0
        assert rec_light.ram_usage is not None and rec_light.ram_usage < 25.0


def test_process_dies_mid_flight_marks_ram_none():
    """
    Kiểm chứng quan trọng: Khi tiến trình đích bị TERMINATE giữa chừng
    (sau khi monitor đã lấy được mẫu RAM), kết quả ram_usage và cpu_usage PHẢI là None.
    """
    repo = AIUsageRepository(db_path=":memory:")
    try:
        # Khởi động một subprocess chạy ngủ 1 giây
        sub = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(1.0)"])
        target_pid = sub.pid

        tracker = ResourceTracker(
            job_id="JOB-MID-DEATH",
            model_name="model-test",
            model_version="1.0",
            scope="process",
            target_pid=target_pid,
            repository=repo
        )

        with tracker:
            time.sleep(0.04)  # Chờ monitor lấy ít nhất 1 mẫu
            # Bắn tín hiệu kill tiến trình đích giữa chừng
            sub.terminate()
            sub.wait()
            time.sleep(0.02)

        rec = tracker.record
        assert rec is not None
        # RAM và CPU phải là None vì tiến trình đã chết trước khi kết thúc
        assert rec.ram_usage is None, f"Expected None do process chết, got {rec.ram_usage}"
        assert rec.cpu_usage is None, f"Expected None do process chết, got {rec.cpu_usage}"
    finally:
        repo.close()


def test_process_scope_dead_pid_from_start_marks_metrics_none():
    """Kiểm chứng khi target_pid là tiến trình không tồn tại ngay từ đầu, metrics nhận giá trị None."""
    repo = AIUsageRepository(db_path=":memory:")
    try:
        with ResourceTracker(
            job_id="JOB-DEAD-PID-START",
            model_name="model-test",
            model_version="1.0",
            scope="process",
            target_pid=99999999,
            repository=repo
        ) as tracker:
            time.sleep(0.02)

        rec = tracker.record
        assert rec is not None
        assert rec.ram_usage is None
        assert rec.cpu_usage is None
    finally:
        repo.close()


def test_cpu_thread_isolation_concurrent_threads():
    """Kiểm chứng % CPU đo lường cô lập theo luồng."""
    repo = AIUsageRepository(db_path=":memory:")
    try:
        heavy_running = True
        def cpu_burner():
            while heavy_running:
                _ = 9999 * 9999

        t_burner = threading.Thread(target=cpu_burner, daemon=True)
        t_burner.start()

        try:
            with ResourceTracker(
                job_id="JOB-CPU-LIGHT",
                model_name="io-model",
                model_version="1.0.0",
                scope="thread",
                repository=repo
            ) as tracker:
                time.sleep(0.08)

            rec = tracker.record
            assert rec is not None
            assert rec.cpu_usage is not None
            assert rec.cpu_usage < 20.0
        finally:
            heavy_running = False
            t_burner.join(timeout=0.2)
    finally:
        repo.close()


# ======================================================================
# 3. GPU LOCK & CROSS-THREAD EXIT SAFETY
# ======================================================================

def test_gpu_cross_thread_exit_releases_lock_and_unblocks_next_job():
    """Kiểm chứng GPU lock được release an toàn khi cross-thread exit."""
    repo = AIUsageRepository(db_path=":memory:")
    try:
        tracker = ResourceTracker("JOB-GPU-CROSS", "gpu-m", "1.0", device="cuda", repository=repo)

        tracker.__enter__()
        assert tracker._gpu_locked is True

        def exit_worker():
            tracker.__exit__(None, None, None)

        t_exit = threading.Thread(target=exit_worker)
        t_exit.start()
        t_exit.join()

        rec = repo.get_latest_by_job_id("JOB-GPU-CROSS")
        assert rec is not None
        assert rec.status == "failed"
        assert "Cross-thread exit" in str(rec.error_message)

        next_job_executed = False
        with ResourceTracker("JOB-GPU-NEXT", "gpu-m", "1.0", device="cuda", repository=repo):
            next_job_executed = True

        assert next_job_executed is True
    finally:
        repo.close()


def test_gpu_vram_serialization_and_attribution():
    """Kiểm chứng GPU lock tuần tự hóa và bảo đảm attribution VRAM riêng cho từng job."""
    repo = AIUsageRepository(db_path=":memory:")
    try:
        max_concurrent_gpu = 0
        current_active = 0
        lock = threading.Lock()

        class MockAllocatingCUDACollector(ResourceCollector):
            def __init__(self):
                super().__init__()
                self.job_vram_map = {}

            def reset_vram(self):
                nonlocal current_active, max_concurrent_gpu
                with lock:
                    current_active += 1
                    if current_active > max_concurrent_gpu:
                        max_concurrent_gpu = current_active

            def set_vram_for_job(self, j_id: str, mb: float):
                self.job_vram_map[j_id] = mb

            def get_vram_usage_mb(self):
                nonlocal current_active
                with lock:
                    current_active -= 1
                return self.job_vram_map.get(threading.current_thread().name, 0.0)

        collector = MockAllocatingCUDACollector()

        def gpu_job_worker(job_id: str, mb: float):
            threading.current_thread().name = job_id
            collector.set_vram_for_job(job_id, mb)
            with ResourceTracker(job_id, "gpu-model", "1.0", device="cuda", repository=repo, collector=collector):
                time.sleep(0.03)

        t1 = threading.Thread(target=gpu_job_worker, args=("JOB-GPU-1", 1024.0))
        t2 = threading.Thread(target=gpu_job_worker, args=("JOB-GPU-2", 2048.0))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert max_concurrent_gpu == 1
        rec1 = repo.get_latest_by_job_id("JOB-GPU-1")
        rec2 = repo.get_latest_by_job_id("JOB-GPU-2")
        assert rec1 is not None and rec1.vram_usage == 1024.0
        assert rec2 is not None and rec2.vram_usage == 2048.0
    finally:
        repo.close()


# ======================================================================
# 4. MONITOR TIMEOUT & SQLITE SCHEMA MIGRATION
# ======================================================================

def test_ram_monitor_real_thread_timeout_marks_unavailable():
    """Kiểm chứng khi sampling bị kẹt, ram_usage được gán None an toàn."""
    class HangingSamplerCollector(ResourceCollector):
        def verify_process_identity(self, pid, expected_create_time):
            return True

        def get_current_ram_mb(self, pid=None, expected_create_time=None):
            time.sleep(0.15)
            return 120.0

    slow_collector = HangingSamplerCollector()
    monitor = _PeakMemoryMonitor(slow_collector, pid=os.getpid(), expected_create_time=1.0, interval_sec=0.001)
    monitor.start()

    peak, is_stopped = monitor.stop(timeout_sec=0.02)
    assert peak is None
    assert is_stopped is False

    monitor.join(timeout=0.5)


def test_sqlite_schema_migration_existing_db():
    """Kiểm chứng tự động di trú SQLite thêm cột measurement_scope."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_file = str(Path(tmp_dir) / "legacy_schema.db")

        conn = sqlite3.connect(db_file)
        conn.execute("""
            CREATE TABLE ai_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                model_name TEXT NOT NULL,
                model_version TEXT NOT NULL,
                processing_time REAL NOT NULL,
                cpu_usage REAL,
                ram_usage REAL,
                vram_usage REAL,
                input_tokens INTEGER,
                output_tokens INTEGER,
                total_tokens INTEGER,
                fallback_used INTEGER DEFAULT 0,
                estimated_cost REAL DEFAULT 0.0,
                status TEXT NOT NULL,
                error_message TEXT,
                created_at TEXT NOT NULL
            );
        """)
        conn.execute("""
            INSERT INTO ai_usage (
                job_id, model_name, model_version, processing_time, status, created_at
            ) VALUES ('JOB-LEGACY-01', 'whisper', 'v2', 1.5, 'success', '2026-10-01T00:00:00Z');
        """)
        conn.commit()
        conn.close()

        repo = AIUsageRepository(db_path=db_file)
        assert repo._is_ready is True

        rec_new = AIUsageRecord(
            job_id="JOB-NEW-01",
            model_name="whisper",
            model_version="v3",
            processing_time=2.0,
            measurement_scope="process"
        )
        assert repo.save(rec_new) is True

        rec_old_read = repo.get_latest_by_job_id("JOB-LEGACY-01")
        rec_new_read = repo.get_latest_by_job_id("JOB-NEW-01")
        repo.close()

        assert rec_old_read is not None
        assert rec_old_read.measurement_scope == "thread"
        assert rec_new_read is not None
        assert rec_new_read.measurement_scope == "process"


def test_sqlite_init_failure_sets_not_ready():
    """Kiểm chứng khi CSDL lỗi, _is_ready=False và save() trả về False an toàn."""
    repo = AIUsageRepository(db_path="/non_existent_dir_xyz/test.db")
    assert repo._is_ready is False
    assert repo._init_error is not None

    rec = AIUsageRecord(job_id="J-FAIL", model_name="m", model_version="v", processing_time=1.0)
    assert repo.save(rec) is False


def test_persistent_storage_across_real_subprocesses():
    """Kiểm chứng tính bền vững CSDL qua 2 tiến trình subprocess thật."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_file = str(Path(tmp_dir) / "isolated_ai_usage.db")

        script_writer = f"""
import sys
from pathlib import Path
sys.path.insert(0, '{str(Path(__file__).resolve().parent.parent)}')
from app.tracking.storage import AIUsageRepository
from app.tracking.contracts import AIUsageRecord

repo = AIUsageRepository(db_path='{db_file}')
rec = AIUsageRecord(
    job_id='JOB-SUBPROC-01',
    model_name='pyannote/speaker-diarization-3.1',
    model_version='3.1.0',
    processing_time=2.456,
    cpu_usage=18.5,
    ram_usage=None,
    vram_usage=None
)
assert repo.save(rec) is True
repo.close()
"""
        proc1 = subprocess.run([sys.executable, "-c", script_writer], capture_output=True, text=True)
        assert proc1.returncode == 0, f"Subprocess 1 lỗi: {proc1.stderr}"

        script_reader = f"""
import sys
from pathlib import Path
sys.path.insert(0, '{str(Path(__file__).resolve().parent.parent)}')
from app.tracking.storage import AIUsageRepository

repo = AIUsageRepository(db_path='{db_file}')
records = repo.get_by_job_id('JOB-SUBPROC-01')
assert len(records) == 1, f'Expected 1 record, got {{len(records)}}'
rec = records[0]
assert rec.job_id == 'JOB-SUBPROC-01'
assert rec.model_name == 'pyannote/speaker-diarization-3.1'
assert rec.processing_time == 2.456
assert rec.ram_usage is None
assert rec.input_tokens is None
repo.close()
"""
        proc2 = subprocess.run([sys.executable, "-c", script_reader], capture_output=True, text=True)
        assert proc2.returncode == 0, f"Subprocess 2 lỗi: {proc2.stderr}"


def test_failed_job_captures_usage_record():
    """Kiểm chứng Job ném ngoại lệ vẫn ghi nhận usage với status='failed'."""
    repo = AIUsageRepository(db_path=":memory:")
    try:
        class CustomPipelineException(Exception):
            pass

        try:
            with ResourceTracker("JOB-FAIL-01", "failing-model", "1.0", repository=repo):
                time.sleep(0.02)
                raise CustomPipelineException("Simulated CUDA Out Of Memory")
        except CustomPipelineException as e:
            assert "Simulated CUDA Out Of Memory" in str(e)

        records = repo.get_by_job_id("JOB-FAIL-01")
        assert len(records) == 1
        assert records[0].status == "failed"
        assert records[0].error_message == "Simulated CUDA Out Of Memory"
    finally:
        repo.close()


def test_tracker_internal_failure_does_not_crash_pipeline():
    """Kiểm chứng Fail-Safe: Lỗi repository không làm crash pipeline."""
    class BrokenRepository(AIUsageRepository):
        def save(self, record):
            raise RuntimeError("Simulated Database Disk Full")

    broken_repo = BrokenRepository(db_path=":memory:")
    executed = False
    try:
        with ResourceTracker("JOB-FAILSAFE-01", "safe-model", "1.0", repository=broken_repo):
            executed = True
        assert executed is True
    finally:
        broken_repo.close()


def test_sprint_3_token_extensibility():
    """Kiểm chứng tính mở rộng cho Token Sprint 3."""
    rec_non_llm = AIUsageRecord(job_id="JOB-AUDIO", model_name="pyannote", model_version="3.1", processing_time=1.5)
    assert rec_non_llm.input_tokens is None
    assert rec_non_llm.output_tokens is None
    assert rec_non_llm.total_tokens is None

    rec_llm = AIUsageRecord(
        job_id="JOB-LLM", model_name="qwen-7b", model_version="1.0", processing_time=2.0,
        input_tokens=1500, output_tokens=300, total_tokens=1800
    )
    d = rec_llm.to_dict()
    assert d["input_tokens"] == 1500
    assert d["output_tokens"] == 300
    assert d["total_tokens"] == 1800


def run_all_tests():
    test_successful_job_tracking()
    test_invalid_tracker_arguments()
    test_thread_scope_concurrent_jobs_ram_is_none()
    test_process_scope_ram_isolation_concurrent_processes()
    test_process_dies_mid_flight_marks_ram_none()
    test_process_scope_dead_pid_from_start_marks_metrics_none()
    test_cpu_thread_isolation_concurrent_threads()
    test_gpu_cross_thread_exit_releases_lock_and_unblocks_next_job()
    test_gpu_vram_serialization_and_attribution()
    test_ram_monitor_real_thread_timeout_marks_unavailable()
    test_sqlite_schema_migration_existing_db()
    test_sqlite_init_failure_sets_not_ready()
    test_persistent_storage_across_real_subprocesses()
    test_failed_job_captures_usage_record()
    test_tracker_internal_failure_does_not_crash_pipeline()
    test_sprint_3_token_extensibility()
    print("ALL_ENHANCED_AI_RESOURCE_TRACKING_TESTS_EXECUTED_SUCCESSFULLY")


if __name__ == "__main__":
    run_all_tests()
