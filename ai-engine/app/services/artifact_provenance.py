"""AI-owned local evidence. These references are NOT Backend artifact IDs.

Verification is a point-in-time check; consumers must revalidate before use.
No network requests, registry claims, or filesystem writes are made here.
"""

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path


def workspace_file(root: Path, relative_path: str) -> Path:
    """Resolve an existing regular file, rejecting traversal and symlinks."""
    root = root.resolve(strict=True)
    relative = Path(relative_path)
    if not relative_path or relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Source must be a relative workspace path")
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Source symlinks are not allowed")
    path = current.resolve(strict=True)
    if root not in path.parents or not path.is_file():
        raise ValueError("Source must be a file inside workspace")
    return path


@dataclass(frozen=True)
class LocalSource:
    meeting_id: str
    job_id: str
    workspace_path: str
    sha256: str

    def to_dict(self) -> dict:
        return {"kind": "LOCAL", **asdict(self)}

    @classmethod
    def from_dict(cls, value: dict) -> "LocalSource":
        if not isinstance(value, dict) or value.get("kind") != "LOCAL":
            raise ValueError("Expected a LOCAL source, not a persistent artifact")
        return cls(**{key: value[key] for key in
                      ("meeting_id", "job_id", "workspace_path", "sha256")})


def capture_local_source(root: Path, path: Path, meeting_id: str, job_id: str) -> LocalSource:
    if not meeting_id or not job_id:
        raise ValueError("Source scope requires meeting_id and job_id")
    root = root.resolve(strict=True)
    # Do not resolve the supplied path before checking symlink components.
    relative = path.absolute().relative_to(root).as_posix()
    safe_path = workspace_file(root, relative)
    digest = hashlib.sha256()
    with safe_path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return LocalSource(str(meeting_id), str(job_id), relative, digest.hexdigest())


def read_verified_source(root: Path, source: LocalSource, meeting_id: str, job_id: str) -> bytes:
    if (source.meeting_id, source.job_id) != (str(meeting_id), str(job_id)):
        raise ValueError("Source belongs to a different meeting/job")
    data = workspace_file(root, source.workspace_path).read_bytes()
    if hashlib.sha256(data).hexdigest() != source.sha256:
        raise ValueError("Source content changed")
    return data


def verify_local_source(root: Path, source: LocalSource, meeting_id: str, job_id: str) -> None:
    """Stream large media instead of loading an entire meeting into memory."""
    if (source.meeting_id, source.job_id) != (str(meeting_id), str(job_id)):
        raise ValueError("Source belongs to a different meeting/job")
    path = workspace_file(root, source.workspace_path)
    actual = capture_local_source(root, path, meeting_id, job_id)
    if actual.sha256 != source.sha256:
        raise ValueError("Source content changed")


def read_verified_json(root: Path, source: LocalSource, meeting_id: str, job_id: str) -> dict:
    value = json.loads(read_verified_source(root, source, meeting_id, job_id))
    if not isinstance(value, dict):
        raise ValueError("Evidence must be a JSON object")
    return value
