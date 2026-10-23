import logging

from app.core.config import settings


LOG_FORMAT = "%(asctime)s [%(levelname)s] [%(name)s] %(message)s"


def setup_logging() -> None:
    """Configure application logging without duplicating handlers."""
    log_level = settings.log_level.upper()

    if log_level not in logging.getLevelNamesMapping():
        raise ValueError(f"Invalid LOG_LEVEL: {log_level}")

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Respect handlers already configured by the runtime.
    if not root_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(LOG_FORMAT))
        root_logger.addHandler(handler)