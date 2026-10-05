import os
import time
import logging
import threading
from typing import Tuple, Optional

logger = logging.getLogger("smartrec.tracking.collector")

_CUDA_DEVICE_LOCK = threading.Lock()


class ResourceCollector:
    """
    Thu thập số liệu tài nguyên phần cứng (CPU, RAM, VRAM) cô lập cho từng AI Job.
    """

    def __init__(self):
        self._has_psutil = False
        try:
            import psutil
            self._psutil = psutil
            self._has_psutil = True
        except ImportError:
            self._psutil = None

        self._has_torch_cuda = False
        try:
            import torch
            if torch.cuda.is_available():
                self._torch = torch
                self._has_torch_cuda = True
            else:
                self._torch = None
        except ImportError:
            self._torch = None

    def get_gpu_lock(self) -> threading.Lock:
        """Trả về khóa GPU lock dạng threading.Lock cho phép giải phóng cross-thread."""
        return _CUDA_DEVICE_LOCK

    def get_process_create_time(self, pid: int) -> Optional[float]:
        """Lấy thời điểm khởi tạo process để xác thực danh tính PID."""
        if not self._has_psutil:
            return None
        try:
            proc = self._psutil.Process(pid)
            if not proc.is_running():
                return None
            return proc.create_time()
        except Exception:
            return None

    def verify_process_identity(self, pid: int, expected_create_time: float) -> bool:
        """Xác thực tiến trình còn sống và chưa bị hệ điều hành tái sử dụng PID."""
        if not self._has_psutil:
            return False
        try:
            proc = self._psutil.Process(pid)
            if not proc.is_running():
                return False
            return abs(proc.create_time() - expected_create_time) < 1e-3
        except Exception:
            return False

    def get_cpu_times(
        self,
        pid: Optional[int] = None,
        expected_create_time: Optional[float] = None
    ) -> Tuple[Optional[float], float]:
        """
        Lấy thời gian CPU: (process_cpu, thread_cpu).
        Nếu là process scope: bắt buộc xác thực danh tính qua expected_create_time.
        """
        thread_cpu = time.thread_time()
        if pid is None:
            return None, thread_cpu

        if not self._has_psutil or expected_create_time is None:
            return None, thread_cpu

        if not self.verify_process_identity(pid, expected_create_time):
            return None, thread_cpu

        try:
            proc = self._psutil.Process(pid)
            times = proc.cpu_times()
            return (times.user + times.system), thread_cpu
        except Exception as e:
            logger.warning(f"Lỗi khi đọc CPU của target_pid={pid}: {e}")
            return None, thread_cpu

    def get_current_ram_mb(
        self,
        pid: Optional[int] = None,
        expected_create_time: Optional[float] = None
    ) -> Optional[float]:
        """
        Lấy dung lượng RAM hiện tại (RSS) (MB).
        Chỉ đo khi có pid và xác thực đúng expected_create_time.
        """
        if pid is None or expected_create_time is None or not self._has_psutil:
            return None

        if not self.verify_process_identity(pid, expected_create_time):
            return None

        try:
            proc = self._psutil.Process(pid)
            return proc.memory_info().rss / (1024 * 1024)
        except Exception as e:
            logger.warning(f"Lỗi khi đọc RAM của target_pid={pid}: {e}")
            return None

    def reset_vram(self) -> None:
        """Reset thống kê peak memory VRAM để Job mới bắt đầu từ mốc 0."""
        if self._has_torch_cuda and self._torch is not None:
            try:
                self._torch.cuda.reset_peak_memory_stats()
            except Exception as e:
                logger.debug(f"reset_peak_memory_stats error: {e}")

    def get_vram_usage_mb(self) -> Optional[float]:
        """Đo lường VRAM đỉnh cấp phát bởi PyTorch allocator trong Job hiện tại."""
        if self._has_torch_cuda and self._torch is not None:
            try:
                allocated = self._torch.cuda.max_memory_allocated() / (1024 * 1024)
                return round(float(allocated), 2)
            except Exception as e:
                logger.debug(f"CUDA max_memory_allocated error: {e}")
                return None
        return None

    def start_snapshot(
        self,
        pid: Optional[int] = None
    ) -> Tuple[float, Optional[float], float, Optional[float], Optional[float]]:
        """
        Ghi nhận snapshot tài nguyên tại thời điểm bắt đầu Job.
        Trả về: (start_wall_time, start_proc_cpu, start_thread_cpu, start_ram_mb, create_time)
        """
        start_wall_time = time.perf_counter()
        create_time = self.get_process_create_time(pid) if pid is not None else None
        start_proc_cpu, start_thread_cpu = self.get_cpu_times(pid=pid, expected_create_time=create_time)
        start_ram_mb = self.get_current_ram_mb(pid=pid, expected_create_time=create_time)
        self.reset_vram()
        return start_wall_time, start_proc_cpu, start_thread_cpu, start_ram_mb, create_time

    def collect_metrics(
        self,
        start_snapshot: Tuple[float, Optional[float], float, Optional[float], Optional[float]],
        observed_peak_ram_mb: Optional[float] = None,
        scope: str = "thread",
        pid: Optional[int] = None
    ) -> Tuple[float, Optional[float], Optional[float], Optional[float]]:
        """
        Tính toán tài nguyên tiêu hao riêng của Job.
        Trả về: (processing_time, cpu_usage_pct, ram_usage_mb, vram_usage_mb)
        """
        end_wall_time = time.perf_counter()
        start_wall, start_proc_cpu, start_thread_cpu, start_ram, create_time = start_snapshot

        processing_time = max(0.0, end_wall_time - start_wall)

        # 1. Tính % CPU
        cpu_usage_pct: Optional[float] = None
        try:
            if scope == "process":
                curr_proc_cpu, _ = self.get_cpu_times(pid=pid, expected_create_time=create_time)
                if start_proc_cpu is not None and curr_proc_cpu is not None:
                    if processing_time > 0:
                        proc_delta = max(0.0, curr_proc_cpu - start_proc_cpu)
                        cpu_count = os.cpu_count() or 1
                        cpu_usage_pct = min(100.0 * cpu_count, (proc_delta / processing_time) * 100.0)
                    else:
                        cpu_usage_pct = 0.0
                else:
                    cpu_usage_pct = None
            else:
                curr_thread_cpu = time.thread_time()
                thread_delta = max(0.0, curr_thread_cpu - start_thread_cpu)
                cpu_usage_pct = min(100.0, (thread_delta / processing_time) * 100.0) if processing_time > 0 else 0.0
        except Exception as e:
            logger.debug(f"CPU calculation error: {e}")
            cpu_usage_pct = None

        # 2. Tính RAM tiêu thụ (Peak RAM Delta)
        if scope == "thread":
            ram_delta_mb = None
        else:
            # Nếu không có create_time, hoặc tiến trình không còn nguyên vẹn, hoặc monitor báo None
            if observed_peak_ram_mb is None or start_ram is None or create_time is None:
                ram_delta_mb = None
            elif not self.verify_process_identity(pid, create_time):
                # Tiến trình đích đã chết hoặc đổi identity tại thời điểm kết thúc
                ram_delta_mb = None
            else:
                ram_delta_mb = round(max(0.0, observed_peak_ram_mb - start_ram), 2)

        # 3. Lấy VRAM đỉnh của Job
        vram_usage_mb = self.get_vram_usage_mb()

        return (
            round(processing_time, 4),
            round(cpu_usage_pct, 2) if cpu_usage_pct is not None else None,
            ram_delta_mb,
            vram_usage_mb,
        )
