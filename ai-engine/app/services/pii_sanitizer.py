import re
import logging
from typing import List, Tuple, Dict, Any

logger = logging.getLogger("smartrec.pii_sanitizer")


class PIISanitizer:
    """Service nhận diện và ẩn/che thông tin cá nhân (PII) và secret nhạy cảm."""

    # Regex nhận diện theo chuẩn quy định
    EMAIL_PATTERN = re.compile(
        r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",
        re.IGNORECASE
    )
    # Số điện thoại Việt Nam (+84 hoặc 0 đầu, theo sau là các đầu số mạng di động VN phổ biến)
    PHONE_PATTERN = re.compile(
        r"(?:\+84|0)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\b"
    )
    # CCCD (12 chữ số) hoặc CMND (9 chữ số)
    ID_CARD_PATTERN = re.compile(
        r"\b(?:[0-9]{12}|[0-9]{9})\b"
    )
    # Thẻ ngân hàng / số tài khoản ngân hàng (10 đến 19 chữ số liên tục)
    BANK_ACCOUNT_PATTERN = re.compile(
        r"\b[0-9]{10,19}\b"
    )
    # Secret / Bearer / JWT Token / API Key
    SECRET_PATTERN = re.compile(
        r"(?:Bearer\s+[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_.+/=]*|"
        r"sk-[A-Za-z0-9_-]{20,}|"
        r"AIza[0-9A-Za-z-_]{35}|"
        r"(?:password|secret|token)\s*[:=]\s*['\"][^\s'\"]+['\"])",
        re.IGNORECASE
    )

    def __init__(self):
        # Thứ tự áp dụng: Secret -> Email -> Phone -> ID Card -> Bank Account
        # (Secret và Email trước để tránh số trong token/email bị match nhầm bởi số điện thoại/bank)
        self.rules: List[Tuple[str, re.Pattern, str]] = [
            ("SECRET", self.SECRET_PATTERN, "[SECRET_REDACTED]"),
            ("EMAIL", self.EMAIL_PATTERN, "[EMAIL_REDACTED]"),
            ("PHONE", self.PHONE_PATTERN, "[PHONE_REDACTED]"),
            ("ID_CARD", self.ID_CARD_PATTERN, "[ID_REDACTED]"),
            ("BANK_ACCOUNT", self.BANK_ACCOUNT_PATTERN, "[BANK_ACCOUNT_REDACTED]"),
        ]

    def redact(self, text: str) -> str:
        """Che toàn bộ thông tin nhạy cảm trong văn bản bằng mã thế chỗ."""
        if not text:
            return text

        sanitized_text = text
        for rule_name, pattern, placeholder in self.rules:
            sanitized_text = pattern.sub(placeholder, sanitized_text)

        return sanitized_text

    def has_pii(self, text: str) -> bool:
        """Kiểm tra văn bản có chứa bất kỳ thông tin PII hoặc secret nào không."""
        if not text:
            return False
        return any(pattern.search(text) is not None for _, pattern, _ in self.rules)

    def detect_pii_types(self, text: str) -> List[str]:
        """Trả về danh sách các loại PII được phát hiện trong văn bản."""
        if not text:
            return []
        detected = []
        for rule_name, pattern, _ in self.rules:
            if pattern.search(text):
                detected.append(rule_name)
        return detected


class LogSanitizerFilter(logging.Filter):
    """Filter ghi log đảm bảo không để rò rỉ token, secret và PII ra màn hình hay file log."""

    def __init__(self, sanitizer: PIISanitizer = None):
        super().__init__()
        self.sanitizer = sanitizer or PIISanitizer()

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self.sanitizer.redact(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    k: self.sanitizer.redact(v) if isinstance(v, str) else v
                    for k, v in record.args.items()
                }
            elif isinstance(record.args, tuple):
                record.args = tuple(
                    self.sanitizer.redact(v) if isinstance(v, str) else v
                    for v in record.args
                )
        return True
