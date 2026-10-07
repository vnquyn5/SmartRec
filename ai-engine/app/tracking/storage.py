import sqlite3
import threading
import logging
from pathlib import Path
from typing import List, Optional
from app.tracking.contracts import AIUsageRecord

logger = logging.getLogger("smartrec.tracking.storage")


class AIUsageRepository:
    """
    Kho lưu trữ bảng nhật ký ai_usage bền vững trên SQLite.
    Hỗ trợ schema migration tự động và kiểm soát trạng thái sẵn sàng (_is_ready).
    """

    def __init__(self, db_path: Optional[str] = None):
        if db_path == ":memory:":
            self.db_path = ":memory:"
        elif db_path:
            self.db_path = str(Path(db_path).resolve())
        else:
            base_dir = Path(__file__).resolve().parent.parent.parent
            data_dir = base_dir / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = str((data_dir / "ai_usage.db").resolve())

        self._lock = threading.Lock()
        self._shared_conn: Optional[sqlite3.Connection] = None
        self._is_closed = False
        self._is_ready = True
        self._init_error: Optional[str] = None

        if self.db_path == ":memory:":
            self._shared_conn = sqlite3.connect(":memory:", check_same_thread=False)
            self._shared_conn.row_factory = sqlite3.Row

        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self._is_closed:
            raise RuntimeError("AIUsageRepository đã được đóng kết nối.")
        if not self._is_ready:
            raise RuntimeError(f"AIUsageRepository chưa sẵn sàng: {self._init_error}")
        if self._shared_conn is not None:
            return self._shared_conn
        conn = sqlite3.connect(self.db_path, timeout=10.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        return conn

    def _close_connection(self, conn: sqlite3.Connection) -> None:
        if conn is not self._shared_conn:
            try:
                conn.close()
            except Exception:
                pass

    def _init_db(self) -> None:
        """Tạo bảng ai_usage và thực hiện schema migration nếu cần."""
        with self._lock:
            conn = None
            try:
                if self._shared_conn is not None:
                    conn = self._shared_conn
                else:
                    conn = sqlite3.connect(self.db_path, timeout=10.0, check_same_thread=False)
                    conn.row_factory = sqlite3.Row

                with conn:
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS ai_usage (
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
                            measurement_scope TEXT DEFAULT 'thread',
                            fallback_used INTEGER DEFAULT 0,
                            estimated_cost REAL DEFAULT 0.0,
                            status TEXT NOT NULL,
                            error_message TEXT,
                            created_at TEXT NOT NULL
                        );
                    """)
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_usage_job_id ON ai_usage(job_id);")

                    cursor = conn.execute("PRAGMA table_info(ai_usage);")
                    existing_columns = {row["name"] for row in cursor.fetchall()}
                    if "measurement_scope" not in existing_columns:
                        logger.info("Phát hiện schema cũ. Đang di trú: bổ sung cột measurement_scope...")
                        conn.execute("ALTER TABLE ai_usage ADD COLUMN measurement_scope TEXT DEFAULT 'thread';")

                self._is_ready = True
                self._init_error = None
            except Exception as e:
                self._is_ready = False
                self._init_error = str(e)
                logger.error(f"Lỗi khởi tạo hoặc di trú bảng ai_usage tại {self.db_path}: {e}", exc_info=True)
            finally:
                if conn is not None:
                    self._close_connection(conn)

    def save(self, record: AIUsageRecord) -> bool:
        """Lưu bản ghi usage vào CSDL. Không bao giờ ném ngoại lệ ra ngoài (fail-safe)."""
        if not self._is_ready:
            logger.error(f"Không thể lưu bản ghi do repository chưa sẵn sàng (Lỗi init/migration: {self._init_error})")
            return False

        if not record or not record.job_id:
            logger.warning("Bỏ qua bản ghi usage không hợp lệ (thiếu job_id).")
            return False

        with self._lock:
            try:
                conn = self._get_connection()
                try:
                    with conn:
                        conn.execute("""
                            INSERT INTO ai_usage (
                                job_id, model_name, model_version, processing_time,
                                cpu_usage, ram_usage, vram_usage,
                                input_tokens, output_tokens, total_tokens,
                                measurement_scope, fallback_used, estimated_cost,
                                status, error_message, created_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            record.job_id,
                            record.model_name,
                            record.model_version,
                            record.processing_time,
                            record.cpu_usage,
                            record.ram_usage,
                            record.vram_usage,
                            record.input_tokens,
                            record.output_tokens,
                            record.total_tokens,
                            record.measurement_scope,
                            1 if record.fallback_used else 0,
                            record.estimated_cost,
                            record.status,
                            record.error_message,
                            record.created_at.isoformat(),
                        ))
                    logger.info(
                        f"[USAGE PERSISTED] job_id={record.job_id} model={record.model_name}:{record.model_version} "
                        f"time={record.processing_time}s cpu={record.cpu_usage}% ram_delta={record.ram_usage}MB "
                        f"vram={record.vram_usage}MB scope={record.measurement_scope} status={record.status}"
                    )
                    return True
                finally:
                    self._close_connection(conn)
            except Exception as e:
                logger.error(f"Lỗi khi lưu bản ghi ai_usage cho job {record.job_id}: {e}", exc_info=True)
                return False

    def get_by_job_id(self, job_id: str) -> List[AIUsageRecord]:
        """Truy xuất toàn bộ bản ghi usage tương ứng với job_id."""
        if not self._is_ready:
            return []
        with self._lock:
            try:
                conn = self._get_connection()
                try:
                    cursor = conn.execute(
                        "SELECT * FROM ai_usage WHERE job_id = ? ORDER BY id ASC",
                        (job_id,)
                    )
                    rows = cursor.fetchall()
                    return [AIUsageRecord.from_dict(dict(r)) for r in rows]
                finally:
                    self._close_connection(conn)
            except Exception as e:
                logger.error(f"Lỗi truy vấn ai_usage cho job {job_id}: {e}")
                return []

    def get_latest_by_job_id(self, job_id: str) -> Optional[AIUsageRecord]:
        """Lấy bản ghi usage gần nhất của job_id."""
        if not self._is_ready:
            return None
        with self._lock:
            try:
                conn = self._get_connection()
                try:
                    cursor = conn.execute(
                        "SELECT * FROM ai_usage WHERE job_id = ? ORDER BY id DESC LIMIT 1",
                        (job_id,)
                    )
                    row = cursor.fetchone()
                    return AIUsageRecord.from_dict(dict(row)) if row else None
                finally:
                    self._close_connection(conn)
            except Exception as e:
                logger.error(f"Lỗi truy vấn bản ghi gần nhất cho job {job_id}: {e}")
                return None

    def list_all(self) -> List[AIUsageRecord]:
        """Liệt kê toàn bộ các bản ghi nhật ký."""
        if not self._is_ready:
            return []
        with self._lock:
            try:
                conn = self._get_connection()
                try:
                    cursor = conn.execute("SELECT * FROM ai_usage ORDER BY id ASC")
                    return [AIUsageRecord.from_dict(dict(r)) for r in cursor.fetchall()]
                finally:
                    self._close_connection(conn)
            except Exception as e:
                logger.error(f"Lỗi liệt kê ai_usage: {e}")
                return []

    def clear(self) -> None:
        """Xóa sạch bảng nhật ký (phục vụ test)."""
        if not self._is_ready:
            return
        with self._lock:
            try:
                conn = self._get_connection()
                try:
                    with conn:
                        conn.execute("DELETE FROM ai_usage;")
                finally:
                    self._close_connection(conn)
            except Exception as e:
                logger.error(f"Lỗi clear bảng ai_usage: {e}")

    def close(self) -> None:
        """Đóng kết nối CSDL."""
        with self._lock:
            if self._shared_conn is not None:
                try:
                    self._shared_conn.close()
                except Exception:
                    pass
                self._shared_conn = None
            self._is_closed = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


_global_repository: Optional[AIUsageRepository] = None
_global_lock = threading.Lock()


def get_usage_repository() -> AIUsageRepository:
    """Lấy repository singleton."""
    global _global_repository
    if _global_repository is None:
        with _global_lock:
            if _global_repository is None:
                _global_repository = AIUsageRepository()
    return _global_repository
