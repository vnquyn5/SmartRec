import json
import os
import stat
import time
from pathlib import Path
from uuid import UUID

import pytest

from app.core.config import settings
from app.schemas.local_llm import ContextEvidence
from app.services.local_llm_debug import (
    LocalLLMDebugStore,
    capture_local_llm_failure,
    replay_capture,
)


JOB_ID = UUID("11111111-1111-4111-8111-111111111111")
SOURCE_ID = UUID("33333333-3333-4333-8333-333333333333")


def _evidence(text="Lan sẽ phải phát triển giao diện đăng nhập."):
    return [ContextEvidence(
        sourceType="TRANSCRIPT",
        sourceId=SOURCE_ID,
        speakerId=None,
        startTimeMs=100,
        endTimeMs=250,
        text=text,
    )]


def _raw_summary(*, title="Build an account platform", assignee=None):
    return json.dumps({
        "schema_version": "smartrec.ai.meeting-summary.v1",
        "executive_summary": "Lan sẽ phải phát triển giao diện đăng nhập.",
        "executive_summary_refs": ["S1"],
        "key_points": [],
        "decisions": [],
        "action_items": [{
            "title": title,
            "assignee": assignee,
            "deadline": None,
            "deadline_raw": None,
            "source_refs": ["S1"],
        }],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }, ensure_ascii=False)


def _store(directory: Path, *, retention_hours=24, max_capture_bytes=524288, max_total_bytes=16777216):
    return LocalLLMDebugStore(
        directory,
        retention_hours=retention_hours,
        max_capture_bytes=max_capture_bytes,
        max_total_bytes=max_total_bytes,
    )


def test_debug_capture_requires_explicit_development_and_capture_gates(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "smartrec_environment", "production")
    monkeypatch.setattr(settings, "smartrec_llm_debug_capture_enabled", True)
    monkeypatch.setattr(settings, "smartrec_llm_debug_dir", tmp_path / "debug")

    assert capture_local_llm_failure(
        job_id=JOB_ID,
        raw_output="{}",
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    ) is None
    assert not (tmp_path / "debug").exists()

    monkeypatch.setattr(settings, "smartrec_environment", "development")
    monkeypatch.setattr(settings, "smartrec_llm_debug_capture_enabled", False)
    assert capture_local_llm_failure(
        job_id=JOB_ID,
        raw_output="{}",
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    ) is None
    assert not (tmp_path / "debug").exists()


def test_capture_is_private_bounded_and_excludes_prompts(tmp_path):
    store = _store(tmp_path / "debug")
    name = store.capture(
        job_id=JOB_ID,
        raw_output=_raw_summary(),
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    )

    assert name is not None
    capture_path = tmp_path / "debug" / name
    assert stat.S_IMODE((tmp_path / "debug").stat().st_mode) == 0o700
    assert stat.S_IMODE(capture_path.stat().st_mode) == 0o600
    capture = store.load(name)
    assert capture["rawOutput"] == _raw_summary()
    assert capture["jobId"] == str(JOB_ID)
    assert capture["failureCode"] == "EVIDENCE_CONSISTENCY_ERROR"
    assert set(capture) == {
        "format", "capturedAt", "jobId", "failureCode",
        "allowedSourceRefs", "evidence", "rawOutput",
    }
    assert "prompt" not in json.dumps(capture).casefold()

    tiny_store = _store(tmp_path / "tiny", max_capture_bytes=1024, max_total_bytes=1024)
    assert tiny_store.capture(
        job_id=JOB_ID,
        raw_output="x" * 2048,
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="JSON_PARSE_ERROR",
    ) is None
    assert tiny_store.list_captures() == []


def test_capture_directory_cannot_be_inside_repository(tmp_path):
    repository_debug_path = Path(__file__).resolve().parents[1] / ".debug-capture-test"
    with pytest.raises(ValueError, match="outside_repository"):
        _store(repository_debug_path).list_captures()


def test_replay_runs_the_same_normalization_and_evidence_validation_without_model_calls(tmp_path):
    store = _store(tmp_path / "debug")
    name = store.capture(
        job_id=JOB_ID,
        raw_output=_raw_summary(),
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    )
    capture = store.load(name)

    result = replay_capture(capture)

    assert result.action_items[0].title == "phát triển giao diện đăng nhập"
    assert result.action_items[0].assignee == "Lan"
    assert result.action_items[0].source_refs == [f"TRANSCRIPT:{SOURCE_ID}"]


def test_replay_safely_removes_action_without_assignment_evidence(tmp_path):
    store = _store(tmp_path / "debug")
    invalid = _raw_summary(title="Create a cloud product", assignee="Lan")
    name = store.capture(
        job_id=JOB_ID,
        raw_output=invalid,
        allowed_source_refs=["S1"],
        evidence=_evidence("Lan sẽ phát triển giao diện đăng nhập."),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    )

    result = replay_capture(store.load(name))
    assert result.action_items == []


def test_capture_retention_and_delete_commands_remove_private_data(tmp_path):
    store = _store(tmp_path / "debug", retention_hours=1)
    name = store.capture(
        job_id=JOB_ID,
        raw_output=_raw_summary(),
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    )
    path = tmp_path / "debug" / name
    old = time.time() - 7200
    os.utime(path, (old, old))

    assert store.prune() == 1
    assert store.list_captures() == []

    replacement = store.capture(
        job_id=JOB_ID,
        raw_output=_raw_summary(),
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    )
    assert replacement is not None
    assert store.delete(replacement)
    assert store.capture(
        job_id=JOB_ID,
        raw_output=_raw_summary(),
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    ) is not None
    assert store.capture(
        job_id=JOB_ID,
        raw_output=_raw_summary(),
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    ) is not None
    assert store.delete_all() == 2
    assert store.list_captures() == []


def test_total_size_budget_evicts_oldest_capture(tmp_path):
    payload = _raw_summary(title="x" * 1200)
    probe = _store(tmp_path / "probe")
    measured_name = probe.capture(
        job_id=JOB_ID,
        raw_output=payload,
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    )
    measured_size = (tmp_path / "probe" / measured_name).stat().st_size
    bounded = _store(
        tmp_path / "bounded",
        max_capture_bytes=measured_size,
        max_total_bytes=measured_size,
    )

    first = bounded.capture(
        job_id=JOB_ID,
        raw_output=payload,
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    )
    second = bounded.capture(
        job_id=JOB_ID,
        raw_output=payload,
        allowed_source_refs=["S1"],
        evidence=_evidence(),
        failure_code="EVIDENCE_CONSISTENCY_ERROR",
    )

    assert first is not None and second is not None
    assert [item[0] for item in bounded.list_captures()] == [second]
