"""Typed failures used to keep deterministic input errors out of Celery retries."""


class NonRetryableProcessingError(Exception):
    def __init__(self, error_code: str, message: str):
        super().__init__(message)
        self.error_code = error_code


class NoSpeechDetectedError(NonRetryableProcessingError):
    def __init__(self, message: str = "No speech was detected in the audio"):
        super().__init__("NO_SPEECH_DETECTED", message)


class RetryableProcessingError(Exception):
    """Transient infrastructure or external-service failure; Celery may retry."""

