import logging
from pathlib import Path

from minio import Minio
from minio.error import S3Error
from urllib3.exceptions import HTTPError as Urllib3HTTPError

from app.core.config import settings
from app.services.minio_client import get_minio_client
from app.workers.processing_errors import (
    NonRetryableProcessingError,
    RetryableProcessingError,
)

logger = logging.getLogger("smartrec.storage")

NON_RETRYABLE_S3_ERRORS = {
    "NoSuchKey",
    "NoSuchObject",
    "NoSuchBucket",
    "NotFound",
    "AccessDenied",
    "InvalidAccessKeyId",
    "SignatureDoesNotMatch",
    "InvalidBucketName",
}
class StorageClient:
    """Shared MinIO storage client for SmartRec AI Workers."""

    def __init__(
        self,
        client: Minio | None = None,
        bucket: str | None = None,
    ) -> None:
        self.client = client if client is not None else get_minio_client()
        self.bucket = bucket if bucket is not None else settings.minio_bucket

    @staticmethod
    def _handle_storage_error(exc: Exception, operation: str) -> None:
        """Convert storage errors into SmartRec processing errors."""

        if isinstance(
            exc,
            (NonRetryableProcessingError, RetryableProcessingError),
        ):
            raise exc

        if isinstance(exc, S3Error):
            if exc.code in NON_RETRYABLE_S3_ERRORS:
                raise NonRetryableProcessingError(
                    "STORAGE_ERROR",
                    f"Storage {operation} failed: {exc.code}",
                ) from exc

            raise RetryableProcessingError(
                f"Storage {operation} failed: {exc.code}"
            ) from exc

        if isinstance(exc, (Urllib3HTTPError, ConnectionError, TimeoutError)):
            raise RetryableProcessingError(
                f"Storage {operation} failed due to a network error"
            ) from exc

        raise exc
    def download_file(
        self,
        object_key: str,
        destination_path: str,
        *,
        allowed_root: str | Path | None = None,
    ) -> str:
        """Download an object from MinIO to a validated local destination."""

        if not object_key or not object_key.strip():
            raise ValueError("object_key must not be empty")

        destination = Path(destination_path)

        if not destination.name:
            raise ValueError("Invalid destination path")

        if allowed_root is not None:
            root = Path(allowed_root).resolve(strict=True)
            resolved_destination = destination.resolve(strict=False)

            if not root.is_dir():
                raise ValueError("allowed_root must be an existing directory")

            if resolved_destination == root or root not in resolved_destination.parents:
                raise PermissionError("Download destination is outside allowed workspace")

            if destination.is_symlink():
                raise PermissionError("Download destination must not be a symlink")

            if destination.exists() and not destination.is_file():
                raise ValueError("Download destination is not a regular file")

        logger.info(
            "Downloading object from bucket=%s, key=%s",
            self.bucket,
            object_key,
        )

        try:
            self.client.fget_object(
                bucket_name=self.bucket,
                object_name=object_key,
                file_path=str(destination),
            )
        except Exception as exc:
            logger.error(
                "Download failed: bucket=%s, key=%s, error=%s",
                self.bucket,
                object_key,
                type(exc).__name__,
            )
            self._handle_storage_error(exc, "download")
            raise

        logger.info("Download completed: %s", object_key)

        return str(destination)

    def upload_file(
        self,
        source_path: str,
        object_key: str,
    ) -> str:
        """Upload a local file to MinIO."""

        if not object_key or not object_key.strip():
            raise ValueError("object_key must not be empty")

        source = Path(source_path)

        if not source.is_file():
            raise FileNotFoundError(
                f"Source file does not exist: {source}"
            )

        logger.info(
            "Uploading object to bucket=%s, key=%s",
            self.bucket,
            object_key,
        )

        try:
            self.client.fput_object(
                bucket_name=self.bucket,
                object_name=object_key,
                file_path=str(source),
            )
        except Exception as exc:
            logger.error(
                "Upload failed: bucket=%s, key=%s, error=%s",
                self.bucket,
                object_key,
                type(exc).__name__,
            )
            self._handle_storage_error(exc, "upload")
            raise

        logger.info("Upload completed: %s", object_key)

        return object_key

    def object_exists(self, object_key: str) -> bool:
        """Check whether an object exists in MinIO."""

        if not object_key or not object_key.strip():
            raise ValueError("object_key must not be empty")

        try:
            self.client.stat_object(
                bucket_name=self.bucket,
                object_name=object_key,
            )
            return True

        except S3Error as exc:
            if exc.code in {"NoSuchKey", "NoSuchObject", "NotFound"}:
                return False

            logger.error(
                "Object check failed: bucket=%s, key=%s, error=%s",
                self.bucket,
                object_key,
                exc.code,
            )
            self._handle_storage_error(exc, "stat")
            raise

        except Exception as exc:
            logger.error(
                "Object check failed: bucket=%s, key=%s, error=%s",
                self.bucket,
                object_key,
                type(exc).__name__,
            )
            self._handle_storage_error(exc, "stat")
            raise