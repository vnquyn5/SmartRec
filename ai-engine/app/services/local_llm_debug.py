"""Opt-in, private capture and offline replay for failed local LLM output."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from app.core.config import settings
from app.schemas.local_llm import ContextEvidence
from app.services.meeting_summary_json import SummaryValidationError
from app.services.meeting_summary_pipeline import normalize_and_validate_local_summary
from app.services.meeting_summary_references import EvidenceReferenceError


_CAPTURE_FORMAT = "smartrec.local-llm-debug.v1"
_CAPTURE_NAME = re.compile(r"capture-[0-9]{8}T[0-9]{6}Z-[0-9a-f-]{36}\.json\Z")
_FAILURE_CODE = re.compile(r"[A-Z][A-Z0-9_]{1,79}\Z")
_CAPTURE_LOCK = threading.RLock()


class LocalLLMDebugStore:
    """Private filesystem store with per-file, total-size, and age limits."""

    def __init__(
        self,
        directory: Path,
        retention_hours: int = 24,
        max_capture_bytes: int = 524288,
        max_total_bytes: int = 16777216,
    ) -> None:
        self.directory = Path(directory).expanduser()
        self.retention_seconds = max(1, int(retention_hours)) * 3600
        self.max_capture_bytes = int(max_capture_bytes)
        self.max_total_bytes = int(max_total_bytes)
        if self.max_capture_bytes < 1 or self.max_total_bytes < self.max_capture_bytes:
            raise ValueError("invalid_debug_storage_limits")

    def _private_directory(self) -> Path:
        if not self.directory.is_absolute():
            raise ValueError("debug_directory_must_be_absolute")
        if self.directory.is_symlink():
            raise ValueError("debug_directory_must_not_be_symlink")
        resolved = self.directory.resolve(strict=False)
        source_path = Path(__file__).resolve()

        if source_path.parents[2] == Path("/app"):
            repository_root = source_path.parents[2]
        else:
            repository_root = source_path.parents[3]

        if resolved == repository_root or repository_root in resolved.parents:
            raise ValueError("debug_directory_must_be_outside_repository")
        resolved.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(resolved, 0o700)
        return resolved

    def _capture_files(self, directory: Path) -> list[Path]:
        return sorted(
            (path for path in directory.glob("capture-*.json")
             if path.is_file() and not path.is_symlink()),
            key=lambda path: path.stat().st_mtime,
        )

    def prune(self) -> int:
        """Remove expired captures and stale atomic-write temporary files."""
        with _CAPTURE_LOCK:
            directory = self._private_directory()
            now = time.time()
            removed = 0
            for path in list(directory.iterdir()):
                if path.is_symlink() or not path.is_file():
                    continue
                stale_temp = path.name.startswith(".capture-")
                expired = now - path.stat().st_mtime > self.retention_seconds
                if stale_temp or (path.suffix == ".json" and expired):
                    path.unlink(missing_ok=True)
                    removed += 1
            return removed

    def capture(
        self,
        *,
        job_id: UUID | str,
        raw_output: str,
        allowed_source_refs: list[str],
        evidence: list[Any],
        failure_code: str,
    ) -> str | None:
        """Store one failed local-model response; never accepts or stores prompts."""
        if not isinstance(raw_output, str):
            return None
        safe_code = (
            failure_code
            if isinstance(failure_code, str) and _FAILURE_CODE.fullmatch(failure_code)
            else "UNKNOWN"
        )
        evidence_payload = [
            item.model_dump(mode="json", by_alias=True)
            if hasattr(item, "model_dump")
            else dict(item)
            for item in evidence
        ]
        payload = {
            "format": _CAPTURE_FORMAT,
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "jobId": str(job_id),
            "failureCode": safe_code,
            "allowedSourceRefs": list(allowed_source_refs),
            "evidence": evidence_payload,
            "rawOutput": raw_output,
        }
        serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(serialized) > self.max_capture_bytes or len(serialized) > self.max_total_bytes:
            return None

        with _CAPTURE_LOCK:
            directory = self._private_directory()
            self.prune()
            files = self._capture_files(directory)
            total = sum(path.stat().st_size for path in files)
            for path in files:
                if total + len(serialized) <= self.max_total_bytes:
                    break
                size = path.stat().st_size
                path.unlink(missing_ok=True)
                total -= size
            if total + len(serialized) > self.max_total_bytes:
                return None

            timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            name = f"capture-{timestamp}-{uuid4()}.json"
            target = directory / name
            descriptor, temporary_name = tempfile.mkstemp(prefix=".capture-", dir=directory)
            try:
                os.fchmod(descriptor, stat.S_IRUSR | stat.S_IWUSR)
                with os.fdopen(descriptor, "wb") as output:
                    output.write(serialized)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary_name, target)
                os.chmod(target, 0o600)
            except Exception:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
                Path(temporary_name).unlink(missing_ok=True)
                raise
            return name

    def list_captures(self) -> list[tuple[str, int, float]]:
        self.prune()
        directory = self._private_directory()
        return [
            (path.name, path.stat().st_size, path.stat().st_mtime)
            for path in self._capture_files(directory)
        ]

    def load(self, name: str) -> dict[str, Any]:
        if not _CAPTURE_NAME.fullmatch(name):
            raise ValueError("invalid_capture_name")
        directory = self._private_directory()
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.resolve().parent != directory:
            raise FileNotFoundError("capture_not_found")
        if path.stat().st_size > self.max_capture_bytes:
            raise ValueError("capture_exceeds_configured_limit")
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("format") != _CAPTURE_FORMAT:
            raise ValueError("unsupported_capture_format")
        return value

    def delete(self, name: str) -> bool:
        if not _CAPTURE_NAME.fullmatch(name):
            raise ValueError("invalid_capture_name")
        directory = self._private_directory()
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.resolve().parent != directory:
            return False
        path.unlink()
        return True

    def delete_all(self) -> int:
        with _CAPTURE_LOCK:
            directory = self._private_directory()
            files = self._capture_files(directory)
            for path in files:
                path.unlink(missing_ok=True)
            return len(files)


def _store_from_settings() -> LocalLLMDebugStore:
    return LocalLLMDebugStore(
        settings.smartrec_llm_debug_dir,
        settings.smartrec_llm_debug_retention_hours,
        settings.smartrec_llm_debug_max_capture_bytes,
        settings.smartrec_llm_debug_max_total_bytes,
    )


def capture_local_llm_failure(
    *,
    job_id: UUID | str,
    raw_output: str,
    allowed_source_refs: list[str],
    evidence: list[Any],
    failure_code: str,
) -> str | None:
    """Fail closed unless both explicit development gates are enabled."""
    if settings.smartrec_environment != "development" or not settings.smartrec_llm_debug_capture_enabled:
        return None
    try:
        return _store_from_settings().capture(
            job_id=job_id,
            raw_output=raw_output,
            allowed_source_refs=allowed_source_refs,
            evidence=evidence,
            failure_code=failure_code,
        )
    except Exception:
        # Do not include exception details, paths, or captured payload in logs.
        return None


def replay_capture(capture: dict[str, Any]):
    """Replay schema parse, reference expansion, normalization, and validation offline."""
    if capture.get("format") != _CAPTURE_FORMAT:
        raise ValueError("unsupported_capture_format")
    if not isinstance(capture.get("rawOutput"), str):
        raise ValueError("capture_missing_raw_output")
    evidence_data = capture.get("evidence")
    refs = capture.get("allowedSourceRefs")
    if not isinstance(evidence_data, list) or not isinstance(refs, list):
        raise ValueError("capture_missing_evidence")
    evidence = [ContextEvidence.model_validate(item) for item in evidence_data]
    return normalize_and_validate_local_summary(capture["rawOutput"], refs, evidence)


def _diagnostics_text(items: list[dict[str, Any]] | tuple[dict[str, Any], ...]) -> str:
    return json.dumps(items, ensure_ascii=True, separators=(",", ":"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Private development-only Local LLM debug captures")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="List retained capture filenames and sizes")
    commands.add_parser("prune", help="Delete expired captures")
    delete_parser = commands.add_parser("delete", help="Delete one capture or every capture")
    delete_group = delete_parser.add_mutually_exclusive_group(required=True)
    delete_group.add_argument("--file")
    delete_group.add_argument("--all", action="store_true")
    replay_parser = commands.add_parser("replay", help="Replay normalization and evidence validation")
    replay_parser.add_argument("file")
    replay_parser.add_argument("--show-result", action="store_true")
    args = parser.parse_args(argv)

    if settings.smartrec_environment != "development":
        print("Set SMARTREC_ENVIRONMENT=development to use Local LLM debug commands.", file=sys.stderr)
        return 2

    store = _store_from_settings()
    try:
        if args.command == "list":
            for name, size, modified in store.list_captures():
                print(f"{name}\t{size} bytes\tmtime={datetime.fromtimestamp(modified, timezone.utc).isoformat()}")
            return 0
        if args.command == "prune":
            print(f"removed={store.prune()}")
            return 0
        if args.command == "delete":
            removed = store.delete_all() if args.all else int(store.delete(args.file))
            print(f"removed={removed}")
            return 0

        capture = store.load(args.file)
        try:
            summary = replay_capture(capture)
        except EvidenceReferenceError:
            print("replay=failed code=SOURCE_REFERENCE_ERROR diagnostics="
                  + _diagnostics_text([{"loc": ["source_refs"], "type": "evidence_reference_mapping"}]))
            return 1
        except SummaryValidationError as exc:
            print(f"replay=failed code={exc.code.value} diagnostics={_diagnostics_text(exc.validation_diagnostics)}")
            return 1

        print(f"replay=passed actionItems={len(summary.action_items)}")
        if args.show_result:
            print(json.dumps(summary.model_dump(mode="json"), ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"debug_command_failed={type(exc).__name__}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
