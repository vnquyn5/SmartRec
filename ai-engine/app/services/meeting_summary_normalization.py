"""Conservative field recovery from trusted meeting evidence.

This module normalizes only claims that can be established from the cited
evidence. Its output is always passed through the unchanged strict schema,
citation, and semantic validators before leaving the API.
"""

from __future__ import annotations

import logging
import re
from copy import deepcopy
from datetime import date
from typing import Any

from app.services.meeting_summary_evidence import (
    _DEADLINE_CONTEXT,
    _claim_support_ratio,
    _confirmed_decision,
    _deadline_refs_are_linked,
    _explicit_deadline_dates,
    _explicit_single_token_assignee,
    evidence_consistency_issues,
    _has_assignment_cue,
    _named_assignment,
    _normalize,
    _normalize_identity,
    _source_ref,
    _value,
    cross_field_consistency_issues,
)

logger = logging.getLogger(__name__)


_WEEKDAY = (
    r"(?:thứ\s*(?:hai|ba|tư|năm|sáu|bảy|nhất|2|3|4|5|6|7)|"
    r"thu\s*(?:hai|ba|tu|nam|sau|bay|nhat|2|3|4|5|6|7)|"
    r"chủ\s*nhật|chu\s*nhat|sunday)"
)
_RELATIVE_TARGET = (
    rf"(?:{_WEEKDAY}|hôm\s*nay|hom\s*nay|ngày\s*mai|ngay\s*mai|"
    r"tuần\s+tới|tuan\s+toi|today|tomorrow|next\s+week)"
)
_RELATIVE_PHRASE = re.compile(
    rf"(?:(?:trước|truoc|đến|den|vào|vao|by|before)\s+(?:ngày\s+|ngay\s+)?"
    rf"{_RELATIVE_TARGET}|{_RELATIVE_TARGET})",
    re.IGNORECASE,
)
_ISO_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_VI_DATE = re.compile(
    r"\b(?:ngày\s*|ngay\s*)?\d{1,2}\s+(?:tháng|thang)\s+\d{1,2}\s+(?:năm|nam)\s+\d{4}\b",
    re.IGNORECASE,
)
_NUMERIC_DATE = re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b")
_AMBIGUOUS_DAY = re.compile(
    r"\b(?:(?:trước|truoc|đến|den|vào|vao|by|before)\s+)?(?:ngày|ngay)\s*\d{1,2}\b",
    re.IGNORECASE,
)
_PROGRESS_REVIEW = re.compile(
    r"\b(?:kiem tra tien do|danh gia tien do|review progress|progress review)\b"
)
_NEXT_MEETING = re.compile(
    r"\b(?:cuoc hop tiep theo|buoi hop tiep theo|next meeting|upcoming meeting)\b"
)
_NULL_MARKERS = {"null", "unknown", "n/a", "na", "chưa xác định", "không rõ"}


def _confirmed_decision_sentences(text: str) -> list[str]:
    """Return only sentences with a positive, completed agreement cue."""
    sentences = [part.strip() for part in re.split(r"(?<=[.!?;])\s+", text) if part.strip()]
    return [sentence for sentence in sentences if _confirmed_decision(sentence)]


def _relative_deadline_phrase(text: str) -> str | None:
    normalized = _normalize(text)
    for match in _RELATIVE_PHRASE.finditer(text):
        phrase = match.group(0).strip(" \t\r\n,.;:()[]{}\"'“”‘’")
        # A bare weekday/date is a deadline only when nearby wording marks it
        # as one. A leading "before/trước/by" is itself an explicit cue.
        starts_with_deadline_word = bool(
            re.match(r"\s*(?:trước|truoc|đến|den|vào|vao|by|before)\b", phrase, re.IGNORECASE)
        )
        if starts_with_deadline_word or _DEADLINE_CONTEXT.search(normalized):
            return phrase
    return None


def _absolute_deadline_phrases(text: str) -> list[tuple[str, str]]:
    """Return explicit (ISO, original phrase) dates with local deadline cues."""
    candidates: list[tuple[str, str]] = []
    for pattern in (_ISO_DATE, _VI_DATE, _NUMERIC_DATE):
        for match in pattern.finditer(text):
            context = _normalize(text[max(0, match.start() - 80):min(len(text), match.end() + 30)])
            if not _DEADLINE_CONTEXT.search(context):
                continue
            phrase_start = match.start()
            prefix = text[max(0, phrase_start - 16):phrase_start]
            marker = re.search(r"(?:trước|đến|vào|before|by)\s+$", prefix, re.IGNORECASE)
            if marker:
                phrase_start -= len(marker.group(0))
            phrase = text[phrase_start:match.end()].strip()
            # Parse the calendar date itself; preserve any leading “trước”,
            # “đến”, “vào”, “before”, or “by” only in deadline_raw.
            normalized_phrase = _normalize(match.group(0))
            date_parts = None
            iso_match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", normalized_phrase)
            vi_match = re.fullmatch(
                r"(?:ngay\s*)?(\d{1,2})\s+thang\s+(\d{1,2})\s+nam\s+(\d{4})",
                normalized_phrase,
            )
            numeric_match = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", normalized_phrase)
            if iso_match:
                date_parts = tuple(map(int, iso_match.groups()))
            elif vi_match:
                day, month, year = map(int, vi_match.groups())
                date_parts = (year, month, day)
            elif numeric_match:
                day, month, year = map(int, numeric_match.groups())
                date_parts = (year, month, day)
            if date_parts is None:
                continue
            try:
                iso = date(*date_parts).isoformat()
            except ValueError:
                continue
            candidates.append((iso, phrase))
    return candidates


def _ambiguous_deadline_phrase(text: str) -> str | None:
    """Keep an explicit day-only deadline raw; it must never become an ISO date."""
    for match in _AMBIGUOUS_DAY.finditer(text):
        context = _normalize(text[max(0, match.start() - 80):min(len(text), match.end() + 30)])
        explicit_before = bool(
            re.match(r"\s*(?:trước|truoc|đến|den|vào|vao|by|before)\b", match.group(0), re.IGNORECASE)
        )
        if _DEADLINE_CONTEXT.search(context) or explicit_before:
            return match.group(0)
    return None


def _is_unassigned_progress_review(source: Any) -> bool:
    text = str(_value(source, "text", ""))
    normalized = _normalize(text)
    return (
        _value(source, "source_type") == "TRANSCRIPT"
        and not _has_assignment_cue(text)
        and bool(_PROGRESS_REVIEW.search(normalized))
        and bool(_NEXT_MEETING.search(normalized))
    )


def _append_ref_in_evidence_order(refs: list[str], ref: str, ordered_evidence: list[Any]) -> None:
    if ref in refs:
        return
    order = {_source_ref(item): index for index, item in enumerate(ordered_evidence)}
    refs.append(ref)
    refs.sort(key=lambda item: order.get(item, len(order)))


def _add_ambiguous_adjacent_date_issues(
    summary: dict[str, Any], ordered_evidence: list[Any]
) -> None:
    """Surface nearby explicit dates whose wording does not link them to a task."""
    by_ref = {_source_ref(item): item for item in ordered_evidence}
    transcript_order = [
        _source_ref(item) for item in ordered_evidence
        if _value(item, "source_type") == "TRANSCRIPT"
    ]
    issues = summary.setdefault("open_issues", [])
    for action in summary.get("action_items", []):
        if action.get("deadline") is not None or action.get("deadline_raw") is not None:
            continue
        title = str(action.get("title", ""))
        assignment_sources = [
            by_ref[ref] for ref in action.get("source_refs", [])
            if ref in by_ref and _has_assignment_cue(str(_value(by_ref[ref], "text", "")))
        ]
        for assignment_source in assignment_sources:
            assignment_ref = _source_ref(assignment_source)
            try:
                assignment_index = transcript_order.index(assignment_ref)
            except ValueError:
                continue
            for date_ref in transcript_order[assignment_index + 1:assignment_index + 2]:
                date_source = by_ref[date_ref]
                if _has_assignment_cue(str(_value(date_source, "text", ""))):
                    continue
                if _deadline_refs_are_linked(date_ref, {assignment_ref}, by_ref, transcript_order):
                    continue
                assignment_start = int(_value(assignment_source, "start_time_ms", 0) or 0)
                assignment_end = int(_value(assignment_source, "end_time_ms", assignment_start) or assignment_start)
                date_start = int(_value(date_source, "start_time_ms", 0) or 0)
                gap_ms = max(0, date_start - assignment_end)
                if gap_ms > 5000:
                    continue
                date_text = str(_value(date_source, "text", ""))
                if not _explicit_deadline_dates(date_text):
                    continue
                if _claim_support_ratio(title, [str(_value(assignment_source, "text", ""))]) < 0.75:
                    continue
                if any(
                    assignment_ref in item.get("source_refs", [])
                    and date_ref in item.get("source_refs", [])
                    and "chưa rõ" in str(item.get("text", "")).casefold()
                    for item in issues
                ):
                    continue
                phrase_candidates = _absolute_deadline_phrases(date_text)
                if not phrase_candidates:
                    continue
                phrase = phrase_candidates[0][1]
                issues.append({
                    "text": (
                        f"Hạn {phrase} được nhắc gần nhiệm vụ “{title}”, "
                        "nhưng transcript chưa xác định rõ mối liên hệ giữa hai đoạn."
                    ),
                    "source_refs": [assignment_ref, date_ref],
                })
                break


def _summary_from_supported_facts(
    summary: dict[str, Any], evidence: list[Any]
) -> tuple[str | None, list[str]]:
    """Compose a summary only from tasks and decisions supported by evidence."""
    sentences: list[str] = []
    refs: list[str] = []
    action_diagnostics = evidence_consistency_issues(summary, evidence)
    invalid_action_indexes = {
        item["loc"][1]
        for item in action_diagnostics
        if len(item.get("loc", [])) > 1 and item["loc"][0] == "action_items"
    }
    for index, action in enumerate(summary.get("action_items", [])):
        if index in invalid_action_indexes:
            continue
        title = str(action.get("title", "")).strip()
        if not title:
            continue
        assignee = action.get("assignee")
        sentence = f"{assignee}: {title}" if assignee else title
        deadline = action.get("deadline_raw") or action.get("deadline")
        if deadline:
            sentence += f" (hạn {deadline})"
        sentences.append(sentence.strip(" .") + ".")
        for ref in action.get("source_refs", []):
            if ref not in refs:
                refs.append(ref)
    by_ref = {_source_ref(item): item for item in evidence}
    for decision in summary.get("decisions", []):
        supported: list[tuple[str, str]] = []
        for ref in decision.get("source_refs", []):
            source = by_ref.get(ref)
            if source is None:
                continue
            supported.extend(
                (sentence, ref)
                for sentence in _confirmed_decision_sentences(str(_value(source, "text", "")))
            )
        unique_sentences = list(dict.fromkeys(sentence for sentence, _ in supported))
        if unique_sentences:
            sentences.extend(unique_sentences)
            for _, ref in supported:
                if ref not in refs:
                    refs.append(ref)
    if not sentences:
        return None, []
    return " ".join(sentences), refs


def _drop_unsupported_summary_claims(
    summary: dict[str, Any], evidence: list[Any]
) -> bool:
    """Remove only claims rejected by deterministic cross-field checks."""
    diagnostics = cross_field_consistency_issues(summary, evidence)
    invalid: dict[str, set[int]] = {"key_points": set(), "next_steps": set(), "open_issues": set()}
    drop_types = {
        "project_deadline_inferred_from_task",
        "unsupported_summary_decision",
        "summary_action_deadline_mismatch",
        "unsupported_summary_assignee",
        "unsupported_summary_claim",
        "assigned_task_misclassified",
        "action_item_duplicated_as_next_step",
    }
    for item in diagnostics:
        loc = item.get("loc", [])
        if len(loc) >= 2 and loc[0] in invalid and item.get("type") in drop_types:
            invalid[loc[0]].add(loc[1])
            logger.warning(
                "Removed unsupported meeting-summary claim: loc=%s type=%s",
                loc,
                item.get("type"),
            )
    changed = False
    for field_name, indexes in invalid.items():
        if indexes:
            summary[field_name] = [
                item for index, item in enumerate(summary.get(field_name, []))
                if index not in indexes
            ]
            changed = True

    executive_invalid = any(
        item.get("loc", [None])[0] == "executive_summary"
        and item.get("type") in drop_types
        for item in diagnostics
    )
    if executive_invalid or (summary.get("executive_summary") is None and summary.get("action_items")):
        if executive_invalid:
            logger.warning(
                "Rebuilt executive summary from supported facts: loc=%s type=%s",
                ["executive_summary"],
                "cross_field_inconsistency",
            )
        executive, refs = _summary_from_supported_facts(summary, evidence)
        summary["executive_summary"] = executive
        summary["executive_summary_refs"] = refs
        changed = True
    return changed


def normalize_summary_from_evidence(summary: dict[str, Any], evidence: list[Any]) -> dict[str, Any]:
    """Repair only explicit names, supported deadlines, citations, and decisions.

    No action item is created from proximity. Missing assignment evidence,
    ambiguous task relationships, and unsupported fields remain subject to the
    strict validator and cause the request to be rejected.
    """
    normalized = deepcopy(summary)
    ordered_evidence = list(evidence)
    by_ref = {_source_ref(item): item for item in ordered_evidence}
    transcript_order = [
        _source_ref(item) for item in ordered_evidence
        if _value(item, "source_type") == "TRANSCRIPT"
    ]

    for action in normalized.get("action_items", []):
        refs = action.get("source_refs", [])
        cited_sources = [by_ref[ref] for ref in refs if ref in by_ref]
        assignment_sources = [
            source for source in cited_sources
            if _has_assignment_cue(str(_value(source, "text", "")))
        ]
        if not assignment_sources:
            # Keep unsupported model claims intact so the validator can report
            # their original failing fields; no repair is safe without cited
            # assignment evidence.
            continue
        refs[:] = [
            ref for ref in refs
            if not _is_unassigned_progress_review(by_ref.get(ref))
        ]
        cited_sources = [by_ref[ref] for ref in refs if ref in by_ref]
        assignment_sources = [
            source for source in cited_sources
            if _has_assignment_cue(str(_value(source, "text", "")))
        ]
        assignment_refs = {_source_ref(source) for source in assignment_sources}

        explicit_subjects = {
            _normalize_identity(subject): subject
            for source in assignment_sources
            if (subject := _explicit_single_token_assignee(str(_value(source, "text", ""))))
        }
        assignee = action.get("assignee")
        if len(explicit_subjects) == 1:
            # A uniquely named explicit subject in the cited assignment is
            # stronger than a model omission, placeholder, or wrong name.
            assignee = next(iter(explicit_subjects.values()))
            action["assignee"] = assignee
        elif isinstance(assignee, str) and assignee.strip().casefold() in _NULL_MARKERS:
            assignee = None
            action["assignee"] = None
        elif assignee is not None and not any(
            _named_assignment(str(_value(source, "text", "")), str(assignee))
            for source in assignment_sources
        ):
            # Unsupported names are removed rather than guessed. The semantic
            # validator still rejects the item if the evidence names someone.
            assignee = None
            action["assignee"] = None

        if assignee is not None:
            matching_assignment_refs = {
                _source_ref(source) for source in assignment_sources
                if _named_assignment(str(_value(source, "text", "")), str(assignee))
            }
            if matching_assignment_refs:
                assignment_refs = matching_assignment_refs

        deadline_sources: dict[str, Any] = {
            _source_ref(source): source for source in cited_sources
        }
        if assignment_refs:
            for source in ordered_evidence:
                ref = _source_ref(source)
                if ref in deadline_sources or _value(source, "source_type") != "TRANSCRIPT":
                    continue
                if _deadline_refs_are_linked(ref, assignment_refs, by_ref, transcript_order):
                    deadline_sources[ref] = source

        relative_candidates: dict[str, tuple[str, str]] = {}
        absolute_candidates: dict[tuple[str, str], tuple[str, str, str]] = {}
        ambiguous_candidates: dict[str, str] = {}
        for ref, source in deadline_sources.items():
            text = str(_value(source, "text", ""))
            if _value(source, "source_type") != "TRANSCRIPT":
                continue
            linked = (
                ref in assignment_refs
                or bool(assignment_refs and _deadline_refs_are_linked(
                    ref, assignment_refs, by_ref, transcript_order
                ))
            )
            if not linked:
                continue
            relative = _relative_deadline_phrase(text)
            if relative:
                relative_candidates.setdefault(_normalize(relative), (relative, ref))
            for iso, phrase in _absolute_deadline_phrases(text):
                absolute_candidates.setdefault((iso, _normalize(phrase)), (iso, phrase, ref))
            ambiguous = _ambiguous_deadline_phrase(text)
            if ambiguous:
                ambiguous_candidates.setdefault(_normalize(ambiguous), (ambiguous, ref))

        if len(relative_candidates) == 1:
            phrase, source_ref = next(iter(relative_candidates.values()))
            action["deadline"] = None
            action["deadline_raw"] = phrase
            _append_ref_in_evidence_order(refs, source_ref, ordered_evidence)
        elif not relative_candidates and len(absolute_candidates) == 1:
            deadline, phrase, source_ref = next(iter(absolute_candidates.values()))
            action["deadline"] = deadline
            action["deadline_raw"] = phrase
            _append_ref_in_evidence_order(refs, source_ref, ordered_evidence)
        elif not relative_candidates and not absolute_candidates and len(ambiguous_candidates) == 1:
            phrase, source_ref = next(iter(ambiguous_candidates.values()))
            action["deadline"] = None
            action["deadline_raw"] = phrase
            _append_ref_in_evidence_order(refs, source_ref, ordered_evidence)
        elif not relative_candidates and not absolute_candidates and not ambiguous_candidates:
            # Do not persist model-generated dates or raw deadline claims that
            # cannot be grounded in the task's cited/linked transcript spans.
            action["deadline"] = None
            action["deadline_raw"] = None

    # Decisions are kept only when their cited transcript contains an explicit
    # completed agreement. Replace paraphrased claims with the exact sentence
    # span, then add any clearly confirmed sentence omitted by the model.
    decisions_by_key: dict[tuple[str, tuple[str, ...]], dict[str, Any]] = {}
    for decision in normalized.get("decisions", []):
        refs = decision.get("source_refs", [])
        supported_sentences = []
        supported_refs = []
        for ref in refs:
            source = by_ref.get(ref)
            if source is None:
                continue
            for sentence in _confirmed_decision_sentences(str(_value(source, "text", ""))):
                supported_sentences.append(sentence)
                supported_refs.append(ref)
        if supported_sentences:
            text = " ".join(dict.fromkeys(supported_sentences))
            unique_refs = tuple(dict.fromkeys(supported_refs))
            decisions_by_key[(_normalize(text), unique_refs)] = {
                "text": text,
                "source_refs": list(unique_refs),
            }

    for source in ordered_evidence:
        if _value(source, "source_type") != "TRANSCRIPT":
            continue
        ref = _source_ref(source)
        for sentence in _confirmed_decision_sentences(str(_value(source, "text", ""))):
            key = (_normalize(sentence), (ref,))
            decisions_by_key.setdefault(key, {"text": sentence, "source_refs": [ref]})

    normalized["decisions"] = list(decisions_by_key.values())
    _add_ambiguous_adjacent_date_issues(normalized, ordered_evidence)
    _drop_unsupported_summary_claims(normalized, ordered_evidence)
    return normalized
