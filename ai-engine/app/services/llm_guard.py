import threading
import logging
from typing import Dict, Set, Optional, Any

from app.core.config import settings

logger = logging.getLogger("smartrec.llm_guard")

_KEY_PREFIX = "smartrec:llm_guard"


class LLMGuardError(Exception):
    """Ngoại lệ cơ sở cho hệ thống kiểm soát hạn mức."""
    pass


class QuotaExceededError(LLMGuardError):
    """Vượt quá số lượng request tối đa cho phép trên một job."""
    pass


class CostLimitExceededError(LLMGuardError):
    """Vượt quá ngân sách chi phí tối đa cho phép trên một job."""
    pass


class DuplicateCallbackError(LLMGuardError):
    """Callback đã được xử lý trước đó, ngăn chặn việc gọi lặp."""
    pass


class LLMGuard:
    """Quản lý hạn mức request, chi phí và tính lũy đẳng (idempotency) theo job.

    Nếu truyền `redis_client`, trạng thái được lưu trên Redis để có hiệu lực xuyên suốt
    nhiều worker và sau khi restart. Khi Redis lỗi giữa chừng, guard tự degrade về bộ nhớ
    cục bộ (có cảnh báo) thay vì làm hỏng luồng xử lý.
    """

    def __init__(
        self,
        max_requests_per_job: Optional[int] = None,
        max_cost_per_job: Optional[float] = None,
        redis_client: Optional[Any] = None,
        state_ttl_seconds: Optional[int] = None,
    ):
        self.max_requests_per_job = max_requests_per_job or settings.job_max_requests_limit
        self.max_cost_per_job = max_cost_per_job or settings.job_max_cost_limit_usd
        self.redis = redis_client
        self.state_ttl_seconds = state_ttl_seconds or settings.llm_guard_state_ttl_seconds
        self._lock = threading.Lock()

        # State tracking theo job_id (dùng khi không có Redis hoặc Redis lỗi)
        self._job_requests: Dict[str, int] = {}
        self._job_costs: Dict[str, float] = {}
        # Set lưu vết (job_id, execution_id) để chống lặp callback
        self._processed_callbacks: Set[str] = set()

    # ------------------------------------------------------------------ helpers
    @property
    def backend(self) -> str:
        return "redis" if self.redis is not None else "memory"

    def _k(self, kind: str, job_id: str, extra: Optional[str] = None) -> str:
        key = f"{_KEY_PREFIX}:{kind}:{job_id}"
        return f"{key}:{extra}" if extra is not None else key

    def _redis_failed(self, op: str, err: Exception) -> None:
        logger.warning(f"Redis lỗi khi {op}: {type(err).__name__}. Degrade về bộ nhớ cục bộ.")

    # ------------------------------------------------------------------ requests
    def check_and_increment_request(self, job_id: str) -> int:
        """Kiểm tra và tăng số đếm request cho job_id. Ném QuotaExceededError nếu vượt ngưỡng."""
        if self.redis is not None:
            try:
                key = self._k("req", job_id)
                count = int(self.redis.incr(key))
                self.redis.expire(key, self.state_ttl_seconds)
                if count > self.max_requests_per_job:
                    self.redis.decr(key)
                    logger.warning(
                        f"[{job_id}] Đã chạm hạn mức request: {count - 1}/{self.max_requests_per_job}"
                    )
                    raise QuotaExceededError(
                        f"Job {job_id} đã vượt quá giới hạn request cho phép ({self.max_requests_per_job})"
                    )
                return count
            except QuotaExceededError:
                raise
            except Exception as e:  # noqa: BLE001
                self._redis_failed("tăng đếm request", e)

        with self._lock:
            current = self._job_requests.get(job_id, 0)
            if current >= self.max_requests_per_job:
                logger.warning(
                    f"[{job_id}] Đã chạm hạn mức request: {current}/{self.max_requests_per_job}"
                )
                raise QuotaExceededError(
                    f"Job {job_id} đã vượt quá giới hạn request cho phép ({self.max_requests_per_job})"
                )
            self._job_requests[job_id] = current + 1
            return self._job_requests[job_id]

    # ------------------------------------------------------------------ cost
    def record_and_check_cost(self, job_id: str, cost: float) -> float:
        """Ghi nhận chi phí cho job và kiểm tra xem có vượt trần không."""
        new_cost: Optional[float] = None
        if self.redis is not None:
            try:
                key = self._k("cost", job_id)
                new_cost = float(self.redis.incrbyfloat(key, cost))
                self.redis.expire(key, self.state_ttl_seconds)
            except Exception as e:  # noqa: BLE001
                self._redis_failed("ghi nhận chi phí", e)
                new_cost = None

        if new_cost is None:
            with self._lock:
                new_cost = self._job_costs.get(job_id, 0.0) + cost
                self._job_costs[job_id] = new_cost

        if new_cost > self.max_cost_per_job:
            logger.warning(
                f"[{job_id}] Chi phí tích lũy {new_cost:.6f} USD vượt quá trần {self.max_cost_per_job:.6f} USD"
            )
            raise CostLimitExceededError(
                f"Job {job_id} đã vượt giới hạn chi phí tối đa ({self.max_cost_per_job} USD)"
            )
        return new_cost

    def _current_cost(self, job_id: str) -> float:
        if self.redis is not None:
            try:
                raw = self.redis.get(self._k("cost", job_id))
                return float(raw) if raw is not None else 0.0
            except Exception as e:  # noqa: BLE001
                self._redis_failed("đọc chi phí", e)
        with self._lock:
            return self._job_costs.get(job_id, 0.0)

    def check_cost_ceiling(self, job_id: str) -> None:
        """Kiểm tra trước xem job đã chạm trần chi phí chưa trước khi gọi dịch vụ ngoài."""
        if self._current_cost(job_id) >= self.max_cost_per_job:
            raise CostLimitExceededError(
                f"Job {job_id} đã chạm ngưỡng chi phí tối đa ({self.max_cost_per_job} USD)"
            )

    # ------------------------------------------------------------------ callbacks
    def is_callback_processed(self, job_id: str, execution_id: Optional[str] = None) -> bool:
        """Kiểm tra callback đã được xử lý hay chưa để tránh lặp."""
        eid = execution_id or "default"
        if self.redis is not None:
            try:
                if self.redis.exists(self._k("cb", job_id, eid)):
                    return True
            except Exception as e:  # noqa: BLE001
                self._redis_failed("kiểm tra callback", e)
        with self._lock:
            return f"{job_id}:{eid}" in self._processed_callbacks

    def mark_callback_processed(self, job_id: str, execution_id: Optional[str] = None) -> None:
        """Đánh dấu callback đã được xử lý."""
        eid = execution_id or "default"
        if self.redis is not None:
            try:
                self.redis.set(self._k("cb", job_id, eid), "1", ex=self.state_ttl_seconds)
            except Exception as e:  # noqa: BLE001
                self._redis_failed("đánh dấu callback", e)
        with self._lock:
            self._processed_callbacks.add(f"{job_id}:{eid}")

    # ------------------------------------------------------------------ stats / reset
    def get_job_stats(self, job_id: str) -> Dict[str, Any]:
        """Lấy thông số thống kê hiện tại của job."""
        if self.redis is not None:
            try:
                raw_req = self.redis.get(self._k("req", job_id))
                return {
                    "requests": int(raw_req) if raw_req is not None else 0,
                    "accumulated_cost": self._current_cost(job_id),
                }
            except Exception as e:  # noqa: BLE001
                self._redis_failed("đọc thống kê", e)
        with self._lock:
            return {
                "requests": self._job_requests.get(job_id, 0),
                "accumulated_cost": self._job_costs.get(job_id, 0.0)
            }

    def reset_job(self, job_id: str) -> None:
        """Dọn dẹp thông tin job (dùng khi job hoàn thành hoặc trong test)."""
        if self.redis is not None:
            try:
                self.redis.delete(self._k("req", job_id), self._k("cost", job_id))
                for key in self.redis.scan_iter(match=self._k("cb", job_id, "*")):
                    self.redis.delete(key)
            except Exception as e:  # noqa: BLE001
                self._redis_failed("dọn dẹp job", e)
        with self._lock:
            self._job_requests.pop(job_id, None)
            self._job_costs.pop(job_id, None)
            keys_to_remove = [k for k in self._processed_callbacks if k.startswith(f"{job_id}:")]
            for k in keys_to_remove:
                self._processed_callbacks.remove(k)


def build_llm_guard() -> LLMGuard:
    """Khởi tạo LLMGuard theo `settings.llm_guard_backend` (auto | redis | memory)."""
    backend = (settings.llm_guard_backend or "auto").lower()
    if backend == "memory":
        return LLMGuard()

    try:
        import redis  # import lười: môi trường dev có thể chưa cài

        client = redis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        client.ping()
        logger.info("LLMGuard dùng Redis backend")
        return LLMGuard(redis_client=client)
    except Exception as e:  # noqa: BLE001
        if backend == "redis":
            raise
        logger.warning(
            f"Không kết nối được Redis ({type(e).__name__}); LLMGuard dùng bộ nhớ cục bộ "
            f"(quota không chia sẻ giữa các worker)."
        )
        return LLMGuard()
