"""Shared local-summary parse, normalization, and evidence-validation pipeline."""

from __future__ import annotations

import json
from typing import Any

from app.schemas.meeting_summary import MeetingSummary
from app.services.meeting_summary_json import SummaryErrorCode, SummaryValidationError, validate_summary_output
from app.services.meeting_summary_normalization import normalize_summary_from_evidence
from app.services.meeting_summary_references import (
    expand_summary_references,
    verify_short_reference_allowlist,
)


def normalize_and_validate_local_summary(
    raw_output: str,
    allowed_source_refs: list[str],
    evidence: list[Any],
) -> MeetingSummary:
    """Run the same strict, ordered pipeline for inference and offline replay."""
    reference_map = verify_short_reference_allowlist(evidence, allowed_source_refs)
    compact_summary = validate_summary_output(
        raw_output,
        MeetingSummary,
        set(reference_map.allowed_short_refs),
    )
    expanded = expand_summary_references(
        compact_summary.model_dump(mode="json"), reference_map
    )
    normalized = normalize_summary_from_evidence(
        expanded, list(reference_map.ordered_evidence)
    )
    summary = validate_summary_output(
        json.dumps(normalized, ensure_ascii=False),
        MeetingSummary,
        reference_map.allowed_original_refs,
        list(reference_map.ordered_evidence),
    )
    if reference_map.allowed_original_refs and summary.executive_summary is None:
        raise SummaryValidationError(
            SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
            "A summary is required when verified source evidence is available",
            validation_diagnostics=({"loc": [], "type": "value_error"},),
        )
    return summary
