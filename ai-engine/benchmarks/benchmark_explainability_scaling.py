
"""Synthetic Explainability scaling benchmark."""

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
from app.services.confidence_scorer import assess_action_item_evidence
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

WORKLOADS = (
    ("small", 1, 1, 100),
    ("medium", 100, 8, 100),
    ("large", 400, 32, 30),
)


def create_workload(evidence_count, action_count):
    evidence = []

    for index in range(evidence_count):
        source_id = UUID(
            f"10000000-0000-4000-8000-{index + 41:012x}"
        )

        if index < action_count:
            text = (
                "Minh phụ trách thiết kế cơ sở dữ liệu."
                if index == 0
                else f"Minh phụ trách thiết kế cơ sở dữ liệu phần {index}."
            )
        else:
            text = (
                f"Nội dung trao đổi kỹ thuật về hệ thống, "
                f"mục thảo luận {index}."
            )

        evidence.append(ContextEvidence(
            source_type="TRANSCRIPT",
            source_id=source_id,
            speaker_id=None,
            start_time_ms=index * 4000 + 1000,
            end_time_ms=index * 4000 + 3000,
            text=text,
        ))

    actions = [
        {
            "title": (
                "Thiết kế cơ sở dữ liệu"
                if index == 0
                else f"Thiết kế cơ sở dữ liệu phần {index}"
            ),
            "assignee": "Minh",
            "deadline": None,
            "deadline_raw": None,
            "source_refs": [f"S{index + 1}"],
        }
        for index in range(action_count)
    ]

    raw_output = json.dumps({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Minh phụ trách thiết kế cơ sở dữ liệu.",
        "executive_summary_refs": ["S1"],
        "key_points": [],
        "decisions": [],
        "action_items": actions,
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }, ensure_ascii=False)

    return (
        raw_output,
        evidence,
        [f"S{index + 1}" for index in range(evidence_count)],
    )


def measure(func, samples):
    for _ in range(WARMUPS):
        func()

    durations = []

    for _ in range(samples):
        start = perf_counter_ns()
        func()
        durations.append((perf_counter_ns() - start) / 1_000_000)

    ordered = sorted(durations)
    p95_index = math.ceil(len(ordered) * 0.95) - 1

    return {
        "samples": samples,
        "p50_ms": round(statistics.median(ordered), 4),
        "p95_ms": round(ordered[p95_index], 4),
        "min_ms": round(ordered[0], 4),
        "max_ms": round(ordered[-1], 4),
    }


def benchmark_workload(name, evidence_count, action_count, samples):
    raw_output, evidence, allowed_refs = create_workload(
        evidence_count, action_count
    )

    summary = normalize_and_validate_local_summary(
        raw_output, allowed_refs, evidence
    )
    diagnostics = evidence_consistency_issues(summary, evidence)
    assessments = assess_action_item_evidence(
        summary, evidence, diagnostics
    )
    expected_metadata = build_action_item_explanations(assessments)

    verified_summary, verified_metadata = (
        normalize_validate_and_explain_local_summary(
            raw_output, allowed_refs, evidence
        )
    )

    assert len(verified_summary.action_items) == action_count
    assert len(verified_metadata["actionItems"]) == action_count
    assert verified_metadata == expected_metadata
    assert verified_metadata["calibrationStatus"] == "NOT_AVAILABLE"

    for index, action in enumerate(verified_summary.action_items):
        assert action.source_refs == [
            f"TRANSCRIPT:{evidence[index].source_id}"
        ]

    for action in verified_metadata["actionItems"]:
        assert all(
            field["score"] is None
            for field in action["fields"].values()
        )

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

    return {
        "workload": name,
        "evidence_count": evidence_count,
        "action_item_count": action_count,
        "warmups": WARMUPS,
        "samples_per_stage": samples,
        "concurrency": 1,
        "correctness": "PASS",
        "results": {
            stage: measure(func, samples)
            for stage, func in stages.items()
        },
    }


def main():
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = "UNKNOWN"

    output = {
        "benchmark": "smartrec.explainability.scaling.v1",
        "environment": environment_metadata(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "commit": commit,
        "source_sha256": hashlib.sha256(
            (
                Path(__file__).resolve().parents[1]
                / "app/services/meeting_summary_evidence.py"
            ).read_bytes()
        ).hexdigest(),
        "timer": "perf_counter_ns",
        "workloads": [
            benchmark_workload(*workload)
            for workload in WORKLOADS
        ],
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
    main()
