
"""Deterministic, synthetic AI-only explainability baseline."""

import hashlib
import json
from pathlib import Path
import math
import platform
import statistics
import subprocess
import sys
from time import perf_counter_ns
from uuid import UUID

from app.schemas.local_llm import ContextEvidence
from app.schemas.meeting_summary import SCHEMA_VERSION
from app.services.confidence_scorer import (
    assess_action_item_evidence,
)
from app.services.explainability_service import (
    build_action_item_explanations,
    normalize_validate_and_explain_local_summary,
)
from app.services.meeting_summary_evidence import (
    evidence_consistency_issues,
)
from app.services.meeting_summary_pipeline import (
    normalize_and_validate_local_summary,
)

WARMUPS = 5
SAMPLES = 100

source_id = UUID("10000000-0000-4000-8000-000000000041")

evidence = [
    ContextEvidence(
        source_type="TRANSCRIPT",
        source_id=source_id,
        speaker_id=None,
        start_time_ms=1000,
        end_time_ms=3000,
        text="Minh phụ trách thiết kế cơ sở dữ liệu.",
    )
]

raw_output = json.dumps({
    "schema_version": SCHEMA_VERSION,
    "executive_summary": "Minh phụ trách thiết kế cơ sở dữ liệu.",
    "executive_summary_refs": ["S1"],
    "key_points": [],
    "decisions": [],
    "action_items": [{
        "title": "Thiết kế cơ sở dữ liệu",
        "assignee": "Minh",
        "deadline": None,
        "deadline_raw": None,
        "source_refs": ["S1"],
    }],
    "open_issues": [],
    "next_steps": [],
    "conflicts": [],
}, ensure_ascii=False)

allowed_refs = ["S1"]

summary = normalize_and_validate_local_summary(
    raw_output, allowed_refs, evidence
)

diagnostics = evidence_consistency_issues(summary, evidence)

assessments = assess_action_item_evidence(
    summary, evidence, diagnostics
)

expected_metadata = build_action_item_explanations(assessments)

def percentile(values, proportion):
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * proportion) - 1)
    return ordered[index]

def measure(func):
    for _ in range(WARMUPS):
        func()

    durations = []

    for _ in range(SAMPLES):
        start = perf_counter_ns()
        func()
        durations.append((perf_counter_ns() - start) / 1_000_000)

    return {
        "samples": len(durations),
        "p50_ms": round(statistics.median(durations), 4),
        "p95_ms": round(percentile(durations, 0.95), 4),
        "min_ms": round(min(durations), 4),
        "max_ms": round(max(durations), 4),
    }

def run():
    stages = {
        "summary_validation": lambda:
            normalize_and_validate_local_summary(
                raw_output, allowed_refs, evidence
            ),
        "evidence_consistency": lambda:
            evidence_consistency_issues(summary, evidence),
        "evidence_assessment": lambda:
            assess_action_item_evidence(
                summary, evidence, diagnostics
            ),
        "explainability_builder": lambda:
            build_action_item_explanations(assessments),
        "full_explainability_pipeline": lambda:
            normalize_validate_and_explain_local_summary(
                raw_output, allowed_refs, evidence
            ),
    }

    verified_summary, verified_metadata = (
        normalize_validate_and_explain_local_summary(
            raw_output, allowed_refs, evidence
        )
    )

    assert verified_metadata == expected_metadata
    assert verified_summary.action_items[0].assignee == "Minh"
    assert verified_metadata["calibrationStatus"] == "NOT_AVAILABLE"
    assert all(
        field["score"] is None
        for action in verified_metadata["actionItems"]
        for field in action["fields"].values()
    )

    results = {
        name: measure(func)
        for name, func in stages.items()
    }

    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = "UNKNOWN"

    output = {
        "benchmark": "smartrec.explainability.baseline.v1",
        "environment": environment_metadata(),
        "workload": "small_synthetic",
        "evidence_count": len(evidence),
        "action_item_count": len(summary.action_items),
        "warmups": WARMUPS,
        "samples_per_stage": SAMPLES,
        "concurrency": 1,
        "timer": "perf_counter_ns",
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "commit": commit,
        "source_sha256": hashlib.sha256(
            (
                Path(__file__).resolve().parents[1]
                / "app/services/meeting_summary_evidence.py"
            ).read_bytes()
        ).hexdigest(),
        "correctness": "PASS",
        "results": results,
    }

    print(json.dumps(output, indent=2, ensure_ascii=False))


def environment_metadata():
    import importlib.metadata
    import os
    import subprocess

    def package_version(name):
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            return "NOT_INSTALLED"

    def sysctl_value(name):
        try:
            return subprocess.check_output(
                ["sysctl", "-n", name],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
        except (OSError, subprocess.CalledProcessError):
            return "UNKNOWN"

    return {
        "cpu_model": sysctl_value("machdep.cpu.brand_string"),
        "logical_cpus": os.cpu_count(),
        "physical_memory_bytes": sysctl_value("hw.memsize"),
        "device": "CPU",
        "dependencies": {
            "pydantic": package_version("pydantic"),
            "fastapi": package_version("fastapi"),
        },
    }


if __name__ == "__main__":
    run()
