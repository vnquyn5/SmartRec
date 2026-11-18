"""Build AI-owned explainability metadata from verified assessments."""

from __future__ import annotations

from typing import Any

EXPLAINABILITY_SCHEMA_VERSION = "smartrec.ai.explainability.v1"

_ALLOWED_STATUSES = {
    "SUPPORTED",
    "UNSUPPORTED",
    "CONFLICTED",
    "UNKNOWN",
}


def build_action_item_explanations(
    assessments: list[dict[str, Any]],
) -> dict[str, Any]:
    """Package field assessments without inventing calibrated confidence."""
    if not isinstance(assessments, list):
        raise ValueError("assessments must be a list")

    action_items = []

    for expected_index, assessment in enumerate(assessments):
        if not isinstance(assessment, dict):
            raise ValueError("assessment must be a dictionary")

        action_index = assessment.get("actionIndex")
        if type(action_index) is not int or action_index != expected_index:
            raise ValueError("actionIndex mismatch")

        refs = assessment.get("sourceRefs")
        resolved_refs = assessment.get("resolvedSourceRefs")
        fields = assessment.get("fields")

        if (
            not isinstance(refs, list)
            or not all(isinstance(ref, str) and ref for ref in refs)
            or not isinstance(resolved_refs, list)
            or not all(
                isinstance(ref, str) and ref for ref in resolved_refs
            )
            or not set(resolved_refs).issubset(set(refs))
            or not isinstance(fields, dict)
        ):
            raise ValueError("invalid action assessment structure")

        normalized_fields = {}

        for field_name, field_data in fields.items():
            if not isinstance(field_name, str) or not isinstance(field_data, dict):
                raise ValueError("invalid field assessment")

            status = field_data.get("status")
            score = field_data.get("score")
            diagnostic_types = field_data.get("diagnosticTypes")

            if status not in _ALLOWED_STATUSES:
                raise ValueError("invalid evidence status")
            if status == "SUPPORTED" and not resolved_refs:
                raise ValueError(
                    "SUPPORTED evidence requires resolved source references"
                )
            if score is not None:
                raise ValueError("uncalibrated confidence score is forbidden")
            if (
                not isinstance(diagnostic_types, list)
                or not all(
                    isinstance(item, str) and item
                    for item in diagnostic_types
                )
            ):
                raise ValueError("invalid diagnostic types")

            normalized_fields[field_name] = {
                "status": status,
                "score": None,
                "diagnosticTypes": sorted(set(diagnostic_types)),
            }

        action_items.append({
            "actionIndex": expected_index,
            "sourceRefs": list(refs),
            "resolvedSourceRefs": list(resolved_refs),
            "fields": normalized_fields,
        })

    return {
        "schemaVersion": EXPLAINABILITY_SCHEMA_VERSION,
        "status": "AVAILABLE" if action_items else "UNKNOWN",
        "calibrationStatus": "NOT_AVAILABLE",
        "actionItems": action_items,
    }


def normalize_validate_and_explain_local_summary(
    raw_output: str,
    allowed_source_refs: list[str],
    evidence: list[Any],
) -> tuple[Any, dict[str, Any]]:
    """Build explainability metadata from the validated summary pipeline.

    The existing inference API and MeetingSummary contract remain unchanged.
    This function is an opt-in AI Engine integration point.
    """
    from app.services.meeting_summary_pipeline import (
        normalize_validate_and_assess_local_summary,
    )

    summary, assessments = normalize_validate_and_assess_local_summary(
        raw_output,
        allowed_source_refs,
        evidence,
    )

    explanations = build_action_item_explanations(assessments)

    if len(explanations["actionItems"]) != len(summary.action_items):
        raise ValueError("Explainability action item count mismatch")

    return summary, explanations


def save_explainability_artifact(
    artifact_path,
    explanations: dict[str, Any],
    meeting_id: str,
    job_id: str,
    *,
    raw_output: str,
    allowed_source_refs: list[str],
    evidence: list[Any],
):
    """Persist only metadata verified against the supplied summary/evidence."""
    from pathlib import Path

    from app.services.artifact_provenance import (
        capture_local_source,
    )
    from app.services.stt_job_integration import (
        _atomic_json,
        _checkpoint_files,
    )

    if not isinstance(explanations, dict):
        raise ValueError("explanations must be a dictionary")

    if explanations.get("schemaVersion") != EXPLAINABILITY_SCHEMA_VERSION:
        raise ValueError("invalid explainability schema version")

    if explanations.get("calibrationStatus") != "NOT_AVAILABLE":
        raise ValueError("invalid calibration status")

    # Revalidate all action assessments before persistence.
    validated = build_action_item_explanations(
        explanations.get("actionItems")
    )

    if validated != explanations:
        raise ValueError("explainability metadata mismatch")

    # Rebuild from the validated summary and actual evidence.
    # Resolved references alone do not establish semantic support.
    _, verified_explanations = (
        normalize_validate_and_explain_local_summary(
            raw_output=raw_output,
            allowed_source_refs=allowed_source_refs,
            evidence=evidence,
        )
    )

    if validated != verified_explanations:
        raise ValueError(
            "explainability metadata does not match verified evidence"
        )

    root, path, _ = _checkpoint_files(artifact_path)

    if path.name != "04_explainability.json":
        raise ValueError("unexpected explainability artifact filename")

    if not meeting_id or not job_id:
        raise ValueError("meeting_id and job_id are required")

    # Reject traversal and non-canonical job identifiers.
    if (
        not isinstance(job_id, str)
        or not job_id
        or Path(job_id).name != job_id
        or job_id in {".", ".."}
    ):
        raise ValueError("invalid job workspace identifier")

    expected_job_dir = root / job_id

    if path.parent != expected_job_dir:
        raise ValueError(
            "explainability artifact must belong to the requested job"
        )

    path.parent.mkdir(parents=True, exist_ok=True)

    _atomic_json(path, validated)

    return capture_local_source(
        root,
        Path(path),
        str(meeting_id),
        str(job_id),
    )
