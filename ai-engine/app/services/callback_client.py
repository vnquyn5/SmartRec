import time
import logging
import requests
from typing import Dict, Any, Optional

logger = logging.getLogger("smartrec.integration.callback")


class CallbackClient:
    """HTTP Client gửi kết quả trạng thái Stage từ AI Engine về Spring Boot."""

    def __init__(self, timeout_sec: float = 10.0, max_retries: int = 3):
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries

    def send_callback(
        self,
        callback_url: str,
        payload: Dict[str, Any],
        job_id: Optional[str] = None,
        internal_token: Optional[str] = "smartrec-internal-ai-secret"
    ) -> bool:
        headers = {
            "Content-Type": "application/json",
            "X-Internal-Token": internal_token or ""
        }
        backoff_delays = [2, 5, 10]
        tag = f"[{job_id}]" if job_id else ""

        for attempt in range(self.max_retries):
            try:
                logger.info(
                    f"{tag} Gửi callback stage={payload.get('stage')} status={payload.get('status')} "
                    f"tới {callback_url} (thử lần {attempt + 1}/{self.max_retries})..."
                )
                response = requests.post(
                    callback_url,
                    json=payload,
                    headers=headers,
                    timeout=self.timeout_sec
                )

                if 200 <= response.status_code < 300:
                    logger.info(f"{tag} Callback thành công: HTTP {response.status_code}")
                    return True
                else:
                    logger.warning(
                        f"{tag} Spring Boot phản hồi lỗi HTTP {response.status_code}: {response.text}"
                    )
            except requests.RequestException as e:
                logger.warning(f"{tag} Lỗi kết nối khi gửi callback: {e}")

            if attempt < self.max_retries - 1:
                time.sleep(backoff_delays[attempt])

        logger.error(f"{tag} Không thể gửi callback sau {self.max_retries} lần thử.")
        return False