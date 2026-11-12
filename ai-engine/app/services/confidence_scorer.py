
"""Extract confidence-related metadata without claiming calibrated accuracy."""

from __future__ import annotations

import math
from typing import Any
import hashlib
import json
from collections.abc import Mapping, Sequence

SCORER_VERSION = "confidence-scorer.v1"


def _finite_number(value: Any) -> float | None:
    """Accept finite numeric values, excluding booleans and invalid inputs."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None

    try:
        number = float(value)
    except (OverflowError, ValueError):
        return None

    return number if math.isfinite(number) else None


def extract_transcript_signals(
    segment: Any,
    *,
    adapter: str,
    model_identifier: str | None,
    model_version: str | None,
    source_segment_id: str,
) -> dict[str, Any]:
    """Extract raw ASR signals while preserving their original granularity."""

    if not adapter.strip() or not source_segment_id.strip():
        raise ValueError("adapter and source_segment_id are required")

    raw_signals: list[dict[str, Any]] = []


    for name, unit in (
        ("avg_logprob", "log_probability"),
        ("no_speech_prob", "model_probability"),
        ("compression_ratio", "ratio"),
    ):
        value = _finite_number(getattr(segment, name, None))

        if value is None:
            continue

        if name == "avg_logprob" and value > 0:
            continue

        if name == "no_speech_prob" and not 0.0 <= value <= 1.0:
            continue

        if name == "compression_ratio" and value <= 0:
            continue

        raw_signals.append({
            "name": name,
            "unit": unit,
            "value": value,
            "granularity": "SOURCE_SEGMENT",
        })


    words: list[dict[str, Any]] = []


    for word in getattr(segment, "words", None) or ():
        probability = _finite_number(getattr(word, "probability", None))
        start = _finite_number(getattr(word, "start", None))
        end = _finite_number(getattr(word, "end", None))

        if probability is None or not 0.0 <= probability <= 1.0:
            continue

        if start is None or end is None or start < 0 or end <= start:
            continue

        words.append({
            "text": getattr(word, "word", ""),
            "start": start,
            "end": end,
            "probability": probability,
        })


    has_signals = bool(raw_signals or words)

    return {
        "scorerVersion": SCORER_VERSION,
        "score": None,
        "status": "UNSCORED" if has_signals else "UNKNOWN",
        "calibrationStatus": "NOT_AVAILABLE",
        "provenance": {
            "adapter": adapter,
            "modelIdentifier": model_identifier,
            "modelVersion": model_version,
            "sourceSegmentId": source_segment_id,
            "granularity": (
                "WORD_LEVEL_SPLIT"
                if getattr(segment, "confidence_granularity", None)
                == "WORD_LEVEL_SPLIT"
                else "SOURCE_SEGMENT"
            ),
            "rawSignals": raw_signals,
            "words": words,
        },
    }


def transcript_segment_fingerprint(segment: Mapping[str, Any]) -> str:
    """Bind metadata to the exact persisted transcript text and timestamps."""
    canonical = {
        "text": segment["text"],
        "startTimeMs": segment["startTimeMs"],
        "endTimeMs": segment["endTimeMs"],
        "speakerId": segment.get("speakerId"),
        "speakerLabel": segment.get("speakerLabel"),
        "attributionStatus": segment.get(
            "attributionStatus", "ATTRIBUTED"
        ),
    }

    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")

    return hashlib.sha256(encoded).hexdigest()


def build_transcript_confidence_sidecar(
    *,
    meeting_id: str,
    job_id: str,
    transcript_segments: Sequence[Mapping[str, Any]],
    confidence_metadata: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Create a request-scoped metadata artifact without changing STT payload."""

    if not meeting_id.strip() or not job_id.strip():
        raise ValueError("Meeting and Job identifiers are required")

    if len(transcript_segments) != len(confidence_metadata):
        raise ValueError("Confidence metadata count does not match transcript")

    entries = []

    for index, (segment, metadata) in enumerate(
        zip(transcript_segments, confidence_metadata)
    ):
        if metadata.get("score") is not None:
            raise ValueError("Uncalibrated numeric confidence is not allowed")

        entries.append({
            "transcriptIndex": index,
            "transcriptFingerprint": transcript_segment_fingerprint(segment),
            "metadata": dict(metadata),
        })

    return {
        "schemaVersion": "smartrec.ai.stt-confidence.v1",
        "meetingId": meeting_id,
        "processingJobId": job_id,
        "scorerVersion": SCORER_VERSION,
        "entries": entries,
    }


def verify_transcript_confidence_sidecar(
    *,
    sidecar: Mapping[str, Any],
    meeting_id: str,
    job_id: str,
    transcript_segments: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Verify sidecar identity and exact transcript alignment before use."""

    if sidecar.get("schemaVersion") != "smartrec.ai.stt-confidence.v1":
        raise ValueError("Unsupported confidence sidecar schema")

    if (
        sidecar.get("meetingId") != meeting_id
        or sidecar.get("processingJobId") != job_id
    ):
        raise ValueError("Confidence sidecar belongs to another meeting/job")

    if sidecar.get("scorerVersion") != SCORER_VERSION:
        raise ValueError("Unsupported confidence scorer version")

    entries = sidecar.get("entries")

    if not isinstance(entries, list) or len(entries) != len(transcript_segments):
        raise ValueError("Confidence sidecar segment count mismatch")

    verified = []

    for index, (entry, segment) in enumerate(zip(entries, transcript_segments)):
        if not isinstance(entry, dict):
            raise ValueError("Invalid confidence sidecar entry")

        if type(entry.get("transcriptIndex")) is not int or entry["transcriptIndex"] != index:
            raise ValueError("Confidence sidecar transcript index mismatch")

        if entry.get("transcriptFingerprint") != transcript_segment_fingerprint(segment):
            raise ValueError("Confidence sidecar transcript fingerprint mismatch")

        metadata = entry.get("metadata")

        if not isinstance(metadata, dict):
            raise ValueError("Invalid confidence metadata")

        if metadata.get("score") is not None:
            raise ValueError("Uncalibrated numeric confidence is not allowed")

        verified.append(dict(metadata))

    return verified


def classify_action_evidence_diagnostics(
    diagnostics,
    action_index,
    field_name,
):
    """Classify existing evidence diagnostics without inventing confidence."""
    if not isinstance(action_index, int) or isinstance(action_index, bool):
        raise ValueError("action_index must be an integer")
    if action_index < 0:
        raise ValueError("action_index must be non-negative")

    matched_types = []

    for diagnostic in diagnostics:
        location = diagnostic.get("loc", ())

        if (
            not isinstance(location, (list, tuple))
            or len(location) < 3
            or location[0] != "action_items"
            or location[1] != action_index
            or location[2] != field_name
        ):
            continue

        issue_type = diagnostic.get("type")

        if isinstance(issue_type, str):
            matched_types.append(issue_type)

    conflict_types = {
        "inconsistent_action_deadline",
        "relative_deadline_resolved",
    }

    unsupported_types = {
        "unassigned_action_item",
        "missing_deadline_source_ref",
        "missing_explicit_assignee",
        "missing_relative_deadline",
        "missing_supported_absolute_deadline",
    }

    if any(issue in conflict_types for issue in matched_types):
        status = "CONFLICTED"
    elif any(
        issue.startswith("unsupported_")
        or issue in unsupported_types
        for issue in matched_types
    ):
        status = "UNSUPPORTED"
    else:
        status = "UNKNOWN"

    return {
        "status": status,
        "score": None,
        "diagnosticTypes": sorted(set(matched_types)),
    }


def assess_action_item_evidence(summary, evidence, diagnostics):
    """Assess action-item evidence conservatively using existing diagnostics.

    Diagnostics must originate from the verified summary/evidence pair.
    Missing diagnostics alone never establish positive support.
    """
    from app.services.meeting_summary_evidence import (
        _claim_support_ratio,
        _contains_phrase,
        _explicit_deadline_dates,
        _has_assignment_cue,
        _has_relative_deadline,
        _named_assignment,
        _source_ref,
    )

    def value(obj, name, default=None):
        if isinstance(obj, dict):
            return obj.get(name, default)
        return getattr(obj, name, default)

    evidence_items = list(evidence)
    by_ref = {
        _source_ref(item): item
        for item in evidence_items
    }

    fields = (
        "title",
        "assignee",
        "deadline",
        "deadline_raw",
        "source_refs",
    )

    results = []

    for index, action in enumerate(value(summary, "action_items", ())):
        refs = list(value(action, "source_refs", ()) or ())
        resolved = [
            ref for ref in refs
            if ref in by_ref
        ]

        cited_texts = [
            str(value(by_ref[ref], "text", "") or "")
            for ref in resolved
        ]

        assessments = {}

        for field_name in fields:
            result = classify_action_evidence_diagnostics(
                diagnostics,
                action_index=index,
                field_name=field_name,
            )

            status = result["status"]

            if status == "UNKNOWN":
                if field_name == "source_refs":
                    if (
                        refs
                        and len(resolved) == len(refs)
                        and all(text.strip() for text in cited_texts)
                    ):
                        status = "SUPPORTED"

                elif field_name == "assignee":
                    assignee = value(action, "assignee")
                    title = str(value(action, "title", "") or "")

                    if (
                        isinstance(assignee, str)
                        and assignee.strip()
                        and title.strip()
                        and refs
                        and len(resolved) == len(refs)
                        and any(
                            _has_assignment_cue(text)
                            and _named_assignment(text, assignee)
                            and _claim_support_ratio(
                                title, [text]
                            ) >= 0.75
                            for text in cited_texts
                        )
                    ):
                        status = "SUPPORTED"

                elif field_name in ("deadline", "deadline_raw"):
                    field_value = value(action, field_name)
                    title = str(value(action, "title", "") or "")
                    assignee = value(action, "assignee")

                    if (
                        isinstance(field_value, str)
                        and field_value.strip()
                        and title.strip()
                        and refs
                        and len(resolved) == len(refs)
                    ):
                        for text in cited_texts:
                            # Require task context in the same cited source.
                            if not _has_assignment_cue(text):
                                continue
                            if _claim_support_ratio(title, [text]) < 0.75:
                                continue
                            if (
                                isinstance(assignee, str)
                                and assignee.strip()
                                and not _named_assignment(text, assignee)
                            ):
                                continue

                            if field_name == "deadline":
                                if (
                                    not _has_relative_deadline(text)
                                    and field_value
                                    in _explicit_deadline_dates(text)
                                ):
                                    status = "SUPPORTED"
                                    break
                            else:
                                if (
                                    _contains_phrase(text, field_value)
                                    and (
                                        _has_relative_deadline(text)
                                        or bool(
                                            _explicit_deadline_dates(text)
                                        )
                                    )
                                ):
                                    status = "SUPPORTED"
                                    break

                elif field_name == "title":
                    title = str(value(action, "title", "") or "")
                    if (
                        title.strip()
                        and refs
                        and len(resolved) == len(refs)
                        and _claim_support_ratio(
                            title, cited_texts
                        ) >= 0.75
                    ):
                        status = "SUPPORTED"

            assessments[field_name] = {
                "status": status,
                "score": None,
                "diagnosticTypes": result["diagnosticTypes"],
            }

        results.append({
            "actionIndex": index,
            "sourceRefs": refs,
            "resolvedSourceRefs": resolved,
            "fields": assessments,
        })

    return results
