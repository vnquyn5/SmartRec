import logging
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Optional, Union

import requests
from pyannote.core import Annotation, Segment

from app.core.config import settings

logger = logging.getLogger("smartrec.cloud_gpu")

# Header bỏ qua trang cảnh báo của ngrok (vô hại với các tunnel khác)
_HEADERS = {"ngrok-skip-browser-warning": "true"}
_MAX_CACHED_RESULTS = 8


class CloudGpuError(Exception):
    """Lỗi khi gọi Cloud GPU diarization server."""


class CloudGpuClient:
    """
    Client gọi server diarization chạy trên Cloud GPU (endpoint POST /diarize).

    Cách xác định địa chỉ server (ưu tiên từ trên xuống):
      1. GitHub Gist "hộp thư" (CLOUD_GPU_REGISTRY_GIST_ID): server GPU tự ghi link tunnel mới nhất
         vào Gist mỗi lần khởi động, ai-engine đọc lại trước mỗi job. Link tunnel đổi bao nhiêu lần
         cũng không cần sửa cấu hình dự án.
      2. CLOUD_GPU_URL: link cố định cấu hình tay (dự phòng).
    Cả hai đều trống thì ai-engine tiếp tục chạy pyannote local như trước.
    """

    def __init__(self) -> None:
        self._embeddings: "OrderedDict[str, Dict[str, List[float]]]" = OrderedDict()
        self._lock = threading.Lock()
        self._registry_url = ""
        self._registry_checked_at = -1e9

    # ------------------------------------------------------------------ cấu hình
    def is_enabled(self) -> bool:
        """Dựa trên cấu hình, không gọi mạng."""
        return bool(
            (settings.cloud_gpu_registry_gist_id or "").strip()
            or (settings.cloud_gpu_url or "").strip()
        )

    def _resolve_from_registry(self) -> str:
        gist_id = (settings.cloud_gpu_registry_gist_id or "").strip()
        if not gist_id:
            return ""

        now = time.monotonic()
        with self._lock:
            if now - self._registry_checked_at < settings.cloud_gpu_registry_ttl_seconds:
                return self._registry_url

        fresh = ""
        try:
            headers = {"Accept": "application/vnd.github+json", "User-Agent": "smartrec-ai-engine"}
            if (settings.cloud_gpu_registry_github_token or "").strip():
                headers["Authorization"] = f"Bearer {settings.cloud_gpu_registry_github_token.strip()}"
            resp = requests.get(
                f"https://api.github.com/gists/{gist_id}",
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            files = resp.json().get("files") or {}
            entry = files.get(settings.cloud_gpu_registry_filename) or next(iter(files.values()), None)
            content = ((entry or {}).get("content") or "").strip()
            if content.startswith("https://"):
                fresh = content.rstrip("/")
        except (requests.RequestException, ValueError) as err:
            logger.warning("Không đọc được Gist registry %s: %s (dùng link đã lưu trước đó nếu có)", gist_id, err)

        with self._lock:
            self._registry_checked_at = now
            if fresh:
                if fresh != self._registry_url:
                    logger.info("Cloud GPU URL từ registry: %s", fresh)
                self._registry_url = fresh
            return self._registry_url

    def base_url(self) -> str:
        return self._resolve_from_registry() or (settings.cloud_gpu_url or "").strip().rstrip("/")

    # ------------------------------------------------------------------ gọi server
    def _check_health(self, base: str) -> None:
        try:
            resp = requests.get(f"{base}/health", headers=_HEADERS, timeout=15)
            resp.raise_for_status()
        except requests.RequestException as err:
            raise CloudGpuError(
                f"Cloud GPU server không phản hồi tại {base} ({err}). "
                "Hãy bật lại server GPU (ô code trên Colab); link mới sẽ tự được cập nhật."
            ) from err

    def diarize(self, audio_path: Union[str, Path]) -> Annotation:
        """Gửi file WAV lên Cloud GPU và dựng lại pyannote Annotation từ danh sách turns."""
        base = self.base_url()
        if not base:
            raise CloudGpuError(
                "Chưa có địa chỉ Cloud GPU: registry chưa có link và CLOUD_GPU_URL đang trống. "
                "Hãy bật server GPU trên Colab."
            )

        path = Path(audio_path)
        if not path.exists():
            raise CloudGpuError(f"Tệp âm thanh không tồn tại: {path}")

        self._check_health(base)

        started = time.perf_counter()
        try:
            with path.open("rb") as fh:
                resp = requests.post(
                    f"{base}/diarize",
                    files={"file": (path.name, fh, "audio/wav")},
                    headers=_HEADERS,
                    timeout=(15, settings.cloud_gpu_timeout_seconds),
                )
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError) as err:
            raise CloudGpuError(f"Gọi Cloud GPU /diarize thất bại: {err}") from err

        if data.get("status") != "SUCCESS":
            raise CloudGpuError(f"Cloud GPU trả về lỗi: {data.get('error') or data}")

        annotation = Annotation(uri=path.stem)
        for turn in data.get("turns", []):
            start, end = float(turn["start"]), float(turn["end"])
            if end > start:
                annotation[Segment(start, end)] = str(turn["speaker"])

        embeddings = {
            str(spk): [float(x) for x in vec]
            for spk, vec in (data.get("embeddings") or {}).items()
        }
        self._remember(path, embeddings)

        logger.info(
            "CLOUD GPU diarization done: file=%s device=%s server_time=%ss total=%.2fs turns=%d speakers=%d",
            path.name,
            data.get("device", "unknown"),
            data.get("process_time_seconds", "n/a"),
            time.perf_counter() - started,
            len(data.get("turns", [])),
            len({t["speaker"] for t in data.get("turns", [])}),
        )
        return annotation

    # ------------------------------------------------------------------ cache embedding
    def _remember(self, path: Path, embeddings: Dict[str, List[float]]) -> None:
        with self._lock:
            self._embeddings[str(path)] = embeddings
            self._embeddings.move_to_end(str(path))
            while len(self._embeddings) > _MAX_CACHED_RESULTS:
                self._embeddings.popitem(last=False)

    def get_embeddings(self, audio_path: Union[str, Path]) -> Optional[Dict[str, List[float]]]:
        with self._lock:
            return self._embeddings.get(str(Path(audio_path)))


cloud_gpu_client = CloudGpuClient()

