import threading
import logging
from typing import Optional, Tuple, Set
from app.tracking.contracts import AIUsageRecord
from app.tracking.collector import ResourceCollector
from app.tracking.storage import AIUsageRepository, get_usage_repository

logger = logging.getLogger("smartrec.tracking.tracker")


class _PeakMemoryMonitor(threading.Thread):
    """Luồng phụ giám sát RAM đỉnh của tiến trình chuyên biệt (khoảng lấy mẫu 5ms)."""

    def __init__(
        self,
        collector: ResourceCollector,
        pid: int,
        expected_create_time: float,
        interval_sec: float = 0.005
    ):
        super().__init__(daemon=True)
        self.collector = collector
        self.pid = pid
        self.expected_create_time = expected_create_time
        self.interval_sec = interval_sec
        self.peak_ram_mb = 0.0
        self._process_died_mid_flight = False
        self._stop_event = threading.Event()

    def run(self):
        while not self._stop_event.is_set():
            try:
                # Kiểm tra danh tính tiến trình
                if not self.collector.verify_process_identity(self.pid, self.expected_create_time):
                    self._process_died_mid_flight = True
                    break

                curr_ram = self.collector.get_current_ram_mb(
                    pid=self.pid,
                    expected_create_time=self.expected_create_time
                )
                if curr_ram is None:
                    self._process_died_mid_flight = True
                    break

                if curr_ram > self.peak_ram_mb:
                    self.peak_ram_mb = curr_ram
            except Exception:
                self._process_died_mid_flight = True
                break
            self._stop_event.wait(self.interval_sec)

    def stop(self, timeout_sec: float = 0.5) -> Tuple[Optional[float], bool]:
        """
        Dừng luồng và xác nhận tính toàn vẹn của kết quả đo.
        Nếu sampler bị timeout, hoặc process chết giữa chừng/kết thúc, trả về (None, ...).
        """
        self._stop_event.set()
        self.join(timeout=timeout_sec)
        is_stopped = not self.is_alive()
        if not is_stopped:
            logger.warning(
                f"Peak memory monitor thread không dừng đúng thời hạn {timeout_sec}s. Đánh dấu RAM là None."
            )
            return None, False

        # Nếu tiến trình bị chết giữa chừng hoặc không còn nguyên vẹn danh tính
        if self._process_died_mid_flight:
            logger.warning(f"Tiến trình pid={self.pid} đã kết thúc trong lúc đang đo. Đánh dấu RAM là None.")
            return None, True

        # Kiểm tra lần cuối xem tiến trình còn sống không
        if not self.collector.verify_process_identity(self.pid, self.expected_create_time):
            logger.warning(f"Tiến trình pid={self.pid} không còn tồn tại tại thời điểm kết thúc. Đánh dấu RAM là None.")
            return None, True

        curr = self.collector.get_current_ram_mb(
            pid=self.pid,
            expected_create_time=self.expected_create_time
        )
        if curr is None:
            return None, True

        return max(self.peak_ram_mb, curr), True


class ResourceTracker:
    """
    Context Manager tự động theo dõi tài nguyên của một AI Job.
    """

    VALID_SCOPES: Set[str] = {"thread", "process"}

    def __init__(
        self,
        job_id: str,
        model_name: str,
        model_version: str,
        device: str = "cpu",
        scope: str = "thread",
        target_pid: Optional[int] = None,
        repository: Optional[AIUsageRepository] = None,
        collector: Optional[ResourceCollector] = None,
    ):
        if not job_id or not isinstance(job_id, str):
            raise ValueError("job_id không được để trống và phải là chuỗi ký tự.")
        if not model_name or not isinstance(model_name, str):
            raise ValueError("model_name không được để trống và phải là chuỗi ký tự.")
        if not model_version or not isinstance(model_version, str):
            raise ValueError("model_version không được để trống và phải là chuỗi ký tự.")

        self.job_id = job_id
        self.model_name = model_name
        self.model_version = model_version
        self.device = str(device).lower()

        scope_normalized = str(scope).lower()
        if scope_normalized not in self.VALID_SCOPES:
            raise ValueError(
                f"scope không hợp lệ: '{scope}'. Chỉ chấp nhận 'thread' hoặc 'process'."
            )
        self.scope = scope_normalized

        if self.scope == "process":
            if target_pid is None or not isinstance(target_pid, int) or target_pid <= 0:
                raise ValueError("Khi scope='process', target_pid bắt buộc phải được truyền và là số nguyên dương (> 0).")

        self.target_pid = target_pid
        self.repository = repository or get_usage_repository()
        self.collector = collector or ResourceCollector()

        self._snapshot = None
        self._monitor: Optional[_PeakMemoryMonitor] = None
        self._record: Optional[AIUsageRecord] = None
        self._gpu_locked = False
        self._entry_thread_id: Optional[int] = None

    def __enter__(self):
        self._entry_thread_id = threading.get_ident()

        if self.device in ("cuda", "gpu"):
            self.collector.get_gpu_lock().acquire()
            self._gpu_locked = True

        try:
            self._snapshot = self.collector.start_snapshot(
                pid=self.target_pid if self.scope == "process" else None
            )
            if self.scope == "process" and self.target_pid is not None:
                create_time = self._snapshot[4] if len(self._snapshot) > 4 else None
                # Chỉ bật monitor khi lấy được create_time hợp lệ
                if create_time is not None:
                    self._monitor = _PeakMemoryMonitor(
                        self.collector,
                        pid=self.target_pid,
                        expected_create_time=create_time
                    )
                    self._monitor.start()
                else:
                    self._monitor = None
            else:
                self._monitor = None
        except Exception as e:
            logger.warning(f"[{self.job_id}] Không thể khởi tạo snapshot tài nguyên: {e}")
            self._snapshot = None
            self._monitor = None
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            exit_thread_id = threading.get_ident()
            cross_thread_error = None
            if self._entry_thread_id and exit_thread_id != self._entry_thread_id:
                cross_thread_error = (
                    f"Cross-thread exit: tracker bắt đầu tại thread {self._entry_thread_id} "
                    f"nhưng kết thúc tại thread {exit_thread_id}."
                )
                logger.error(f"[{self.job_id}] {cross_thread_error}")

            peak_ram = None
            if self._monitor is not None:
                try:
                    peak_ram, stopped_cleanly = self._monitor.stop(timeout_sec=0.5)
                    if not stopped_cleanly:
                        peak_ram = None
                except Exception as me:
                    logger.debug(f"Monitor stop error: {me}")
                    peak_ram = None

            if self._snapshot is not None:
                proc_time, cpu, ram, vram = self.collector.collect_metrics(
                    self._snapshot,
                    observed_peak_ram_mb=peak_ram,
                    scope=self.scope,
                    pid=self.target_pid if self.scope == "process" else None
                )
            else:
                proc_time, cpu, ram, vram = 0.0, None, None, None

            if cross_thread_error:
                status = "failed"
                err_msg = cross_thread_error
            elif exc_type is not None:
                status = "failed"
                err_msg = str(exc_val)
            else:
                status = "success"
                err_msg = None

            self._record = AIUsageRecord(
                job_id=self.job_id,
                model_name=self.model_name,
                model_version=self.model_version,
                processing_time=proc_time,
                cpu_usage=cpu,
                ram_usage=ram,
                vram_usage=vram,
                measurement_scope=self.scope,
                status=status,
                error_message=err_msg,
            )

            self.repository.save(self._record)
        except Exception as e:
            logger.error(f"[{self.job_id}] Lỗi nội bộ trong ResourceTracker.__exit__: {e}", exc_info=True)
        finally:
            if self._gpu_locked:
                try:
                    self.collector.get_gpu_lock().release()
                except Exception as le:
                    logger.error(f"[{self.job_id}] GPU lock release error: {le}")
                self._gpu_locked = False

        return False

    @property
    def record(self) -> Optional[AIUsageRecord]:
        """Lấy bản ghi usage sau khi kết thúc tracking."""
        return self._record
