import logging
import subprocess
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
            resp = requests.get(f"{base}/health", headers=_HEADERS, timeout=30)
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
        upload_path = path
        temp_compressed = None
        data = None
        try:
            # Đối với file âm thanh lớn hoặc file WAV PCM, nén sang MP3 mono 48kbps trước khi gửi qua Cloudflare Tunnel.
            # Giúp file 2 tiếng giảm từ ~240MB xuống chỉ còn ~30-40MB (vượt qua giới hạn 100MB của Cloudflare và tăng tốc upload gấp 6 lần).
            file_size_mb = path.stat().st_size / (1024 * 1024)
            if file_size_mb > 10 or path.suffix.lower() == ".wav":
                temp_compressed = path.with_suffix(".cloud_gpu_compressed.mp3")
                logger.info(
                    "Đang nén audio (%.1f MB) sang MP3 mono 32k để gửi siêu tốc lên Cloud GPU...",
                    file_size_mb,
                )
                cmd = [
                    "ffmpeg", "-y", "-threads", "0", "-i", str(path),
                    "-vn", "-ar", "16000", "-ac", "1",
                    "-c:a", "libmp3lame", "-b:a", "32k",
                    str(temp_compressed),
                ]
                res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if res.returncode == 0 and temp_compressed.exists() and temp_compressed.stat().st_size > 0:
                    compressed_mb = temp_compressed.stat().st_size / (1024 * 1024)
                    logger.info(
                        "Nén thành công: %.1f MB -> %.1f MB (giảm %.1f%%)",
                        file_size_mb,
                        compressed_mb,
                        (1 - compressed_mb / file_size_mb) * 100,
                    )
                    upload_path = temp_compressed

            mime_type = "audio/mpeg" if upload_path.suffix.lower() == ".mp3" else "audio/wav"
            init_data = None
            last_post_err = None
            for attempt in range(1, 4):
                try:
                    with upload_path.open("rb") as fh:
                        resp = requests.post(
                            f"{base}/diarize",
                            files={"file": (upload_path.name, fh, mime_type)},
                            headers=_HEADERS,
                            timeout=(30, 300),
                        )
                    resp.raise_for_status()
                    init_data = resp.json()
                    break
                except (requests.RequestException, ValueError) as post_err:
                    last_post_err = post_err
                    logger.warning("Thử gửi file lên Cloud GPU lần %d/3 gặp lỗi: %s", attempt, post_err)
                    time.sleep(2)
                    base = self.base_url() or base
            if init_data is None:
                raise last_post_err

            # Nếu server trả về task_id (chế độ async polling chống timeout 524 của Cloudflare)
            task_id = init_data.get("task_id")
            if task_id:
                logger.info("Cloud GPU đã nhận file, task_id=%s. Bắt đầu theo dõi tiến trình...", task_id)
                poll_started = time.perf_counter()
                while True:
                    time.sleep(3)
                    try:
                        poll_resp = requests.get(
                            f"{base}/diarize/status/{task_id}",
                            headers=_HEADERS,
                            timeout=20,
                        )
                        poll_resp.raise_for_status()
                        res = poll_resp.json()
                        st = res.get("status")
                        if st == "SUCCESS":
                            data = res
                            logger.info(
                                "Cloud GPU task %s hoàn tất thành công sau %.1fs",
                                task_id,
                                time.perf_counter() - poll_started,
                            )
                            break
                        elif st == "FAILED":
                            raise CloudGpuError(f"Cloud GPU task {task_id} thất bại: {res.get('error')}")
                        elif st == "PROCESSING":
                            elapsed = res.get("elapsed_seconds", round(time.perf_counter() - poll_started, 1))
                            logger.info("Cloud GPU task %s đang phân tích trên GPU (%.1fs)...", task_id, elapsed)
                    except requests.RequestException as poll_err:
                        logger.warning("Lỗi tạm thời khi poll GPU status: %s", poll_err)
                        if time.perf_counter() - poll_started > settings.cloud_gpu_timeout_seconds:
                            raise CloudGpuError(f"Quá thời gian chờ kết quả GPU: {poll_err}") from poll_err
            else:
                data = init_data
        except (requests.RequestException, ValueError) as err:
            raise CloudGpuError(f"Gọi Cloud GPU /diarize thất bại: {err}") from err
        finally:
            if temp_compressed and temp_compressed.exists():
                try:
                    temp_compressed.unlink()
                except Exception:
                    pass

        if not data or data.get("status") != "SUCCESS":
            raise CloudGpuError(f"Cloud GPU trả về lỗi: {(data or {}).get('error') or data}")

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
