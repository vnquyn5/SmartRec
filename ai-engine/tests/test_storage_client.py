from pathlib import Path
from unittest.mock import MagicMock

import pytest
from minio.error import S3Error

from app.services.storage_client import StorageClient
from app.workers.processing_errors import (
    NonRetryableProcessingError,
    RetryableProcessingError,
)


@pytest.fixture
def storage():
    client = MagicMock()
    return StorageClient(client=client, bucket="test-bucket")


def make_s3_error(code):
    return S3Error(
        code=code,
        message="Test error",
        resource="/test-object",
        request_id="test-request",
        host_id="test-host",
        response=None,
    )


def test_download_success(storage, tmp_path):
    destination = tmp_path / "audio.mp3"
    result = storage.download_file("audio/test.mp3", str(destination))

    storage.client.fget_object.assert_called_once_with(
        bucket_name="test-bucket",
        object_name="audio/test.mp3",
        file_path=str(destination),
    )
    assert result == str(destination)


def test_download_object_not_found(storage, tmp_path):
    storage.client.fget_object.side_effect = make_s3_error("NoSuchKey")

    with pytest.raises(NonRetryableProcessingError) as exc:
        storage.download_file("missing.mp3", str(tmp_path / "audio.mp3"))

    assert exc.value.error_code == "STORAGE_ERROR"


def test_download_connection_error(storage, tmp_path):
    storage.client.fget_object.side_effect = ConnectionError("Connection refused")

    with pytest.raises(RetryableProcessingError):
        storage.download_file("audio.mp3", str(tmp_path / "audio.mp3"))


def test_upload_success(storage, tmp_path):
    source = tmp_path / "result.json"
    source.write_text('{"status":"COMPLETED"}', encoding="utf-8")

    result = storage.upload_file(str(source), "results/result.json")

    storage.client.fput_object.assert_called_once_with(
        bucket_name="test-bucket",
        object_name="results/result.json",
        file_path=str(source),
    )
    assert result == "results/result.json"


def test_upload_access_denied(storage, tmp_path):
    source = tmp_path / "result.json"
    source.write_text("{}", encoding="utf-8")
    storage.client.fput_object.side_effect = make_s3_error("AccessDenied")

    with pytest.raises(NonRetryableProcessingError) as exc:
        storage.upload_file(str(source), "results/result.json")

    assert exc.value.error_code == "STORAGE_ERROR"


def test_upload_connection_error(storage, tmp_path):
    source = tmp_path / "result.json"
    source.write_text("{}", encoding="utf-8")
    storage.client.fput_object.side_effect = ConnectionError("Connection refused")

    with pytest.raises(RetryableProcessingError):
        storage.upload_file(str(source), "results/result.json")


def test_object_exists(storage):
    assert storage.object_exists("audio.mp3") is True

    storage.client.stat_object.assert_called_once_with(
        bucket_name="test-bucket",
        object_name="audio.mp3",
    )


def test_object_not_found(storage):
    storage.client.stat_object.side_effect = make_s3_error("NoSuchKey")

    assert storage.object_exists("missing.mp3") is False


def test_object_access_denied(storage):
    storage.client.stat_object.side_effect = make_s3_error("AccessDenied")

    with pytest.raises(NonRetryableProcessingError) as exc:
        storage.object_exists("audio.mp3")

    assert exc.value.error_code == "STORAGE_ERROR"


def test_object_connection_error(storage):
    storage.client.stat_object.side_effect = ConnectionError("Connection refused")

    with pytest.raises(RetryableProcessingError):
        storage.object_exists("audio.mp3")