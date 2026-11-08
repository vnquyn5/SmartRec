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
    evidence_consistency_issues,
    extract_explicit_assignment_facts,
    _has_assignment_cue,
    _normalize,
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
    rf"(?:{_WEEKDAY}(?:\s+(?:tuần\s+(?:sau|tới|kế\s+tiếp)|tuan\s+(?:sau|toi|ke\s+tiep)|"
    rf"của\s+tuần\s+kế\s+tiếp|cua\s+tuan\s+ke\s+tiep))?|hôm\s*nay|hom\s*nay|ngày\s*mai|ngay\s*mai|"
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
    # Persisted ASR rendered “tiến độ” as “tiến đấu”. The surrounding
    # next-meeting and no-assignment checks keep this typo repair narrow.
    r"\b(?:kiem tra tien do|kiem tra tien dau|danh gia tien do|review progress|progress review)\b"
)
_NEXT_MEETING = re.compile(
    r"\b(?:cuoc hop tiep theo|buoi hop tiep theo|next meeting|upcoming meeting)\b"
)


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


def _trim_title_deadline_tail(title: str, deadline_phrase: str | None) -> str:
    if deadline_phrase:
        match = re.search(re.escape(deadline_phrase), title, re.IGNORECASE)
        if match:
            title = title[:match.start()]
        title = re.sub(r"\s+(?:được|duoc|vào|vao|là|la|deadline)\s*$", "", title, flags=re.IGNORECASE)
        title = re.sub(
            r"\s+(?:(?:và|and)\s+)?(?:(?:phải|sẽ|must|will)\s+)?"
            r"(?:hoàn\s+thành|hoàn\s+tất|hoan\s+thanh|hoan\s+tat|complete|finish)"
            r"(?:\s+(?:được|duoc|xong))?\s*$",
            "",
            title,
            flags=re.IGNORECASE,
        )
    return title.strip(" \t\r\n,.;:()[]{}\"'“”‘’")


def _is_unassigned_progress_review(source: Any) -> bool:
    text = str(_value(source, "text", ""))
    normalized = _normalize(text)
    return (
        _value(source, "source_type") == "TRANSCRIPT"
        and not _has_assignment_cue(text)
        and bool(_PROGRESS_REVIEW.search(normalized))
        and bool(_NEXT_MEETING.search(normalized))
    )


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
    """Recover only directly parseable assignment phrases and supported facts.

    Actions are never inferred from proximity. Named or first-person tasks are
    recovered only from an affirmative assignment cue and verbatim task phrase;
    all output still passes the strict evidence validator.
    """
    normalized = deepcopy(summary)
    ordered_evidence = list(evidence)
    by_ref = {_source_ref(item): item for item in ordered_evidence}
    transcript_order = [
        _source_ref(item) for item in ordered_evidence
        if _value(item, "source_type") == "TRANSCRIPT"
    ]

    # Rebuild action items from the shared, conservative evidence extractor.
    # This removes unsupported model claims and recovers only explicitly
    # assigned/committed source phrases. Unparseable cues remain uncovered and
    # therefore fail the strict validator rather than becoming guessed tasks.
    extracted: list[dict[str, Any]] = []
    for source in ordered_evidence:
        if _value(source, "source_type") not in {"TRANSCRIPT", "SLIDE_OCR"}:
            continue
        source_ref = _source_ref(source)
        text = str(_value(source, "text", ""))
        facts = extract_explicit_assignment_facts(text, source_ref)
        for fact in facts:
            fact["_evidence_text"] = str(fact.get("_evidence_text", text))
            extracted.append(fact)

    # Match model titles to extracted tasks only to preserve a paraphrase that
    # already passes the existing lexical evidence check. Unsupported claims,
    # names, and dates never survive this mapping.
    candidates: dict[int, list[tuple[float, str]]] = {index: [] for index in range(len(extracted))}
    fact_indexes_by_ref: dict[str, list[int]] = {}
    for index, fact in enumerate(extracted):
        for ref in fact["source_refs"]:
            fact_indexes_by_ref.setdefault(ref, []).append(index)
    for model_action in summary.get("action_items", []):
        refs = list(model_action.get("source_refs", []))
        title = str(model_action.get("title", ""))
        possible = list(dict.fromkeys(
            index for ref in refs for index in fact_indexes_by_ref.get(ref, [])
        ))
        if not possible:
            continue
        scored = [
            (
                _claim_support_ratio(title, [
                    str(extracted[index]["title"]),
                    str(extracted[index]["_evidence_text"]),
                ]),
                index,
            )
            for index in possible
        ]
        score, best_index = max(scored, key=lambda item: item[0])
        # A zero-overlap title has no safe mapping; the evidence fact is still
        # recovered independently below, while this model claim is discarded.
        if score > 0:
            fact = extracted[best_index]
            if _claim_support_ratio(title, [str(fact["_evidence_text"])]) >= 0.75:
                candidates[best_index].append((score, title))

    normalized_actions: list[dict[str, Any]] = []
    for index, fact in enumerate(extracted):
        source_ref = fact["source_refs"][0]
        evidence_text = str(fact["_evidence_text"])
        refs = [source_ref]
        source_text_by_ref = {source_ref: evidence_text}

        # Dates in a separately persisted evidence segment are usable only
        # when the existing timestamp/order linker establishes the relation.
        for candidate_source in ordered_evidence:
            candidate_ref = _source_ref(candidate_source)
            if candidate_ref == source_ref or _value(candidate_source, "source_type") != "TRANSCRIPT":
                continue
            if _deadline_refs_are_linked(candidate_ref, {source_ref}, by_ref, transcript_order):
                candidate_text = str(_value(candidate_source, "text", ""))
                if (
                    _relative_deadline_phrase(candidate_text)
                    or _absolute_deadline_phrases(candidate_text)
                    or _ambiguous_deadline_phrase(candidate_text)
                ):
                    refs.append(candidate_ref)
                    source_text_by_ref[candidate_ref] = candidate_text

        relative_candidates: dict[str, str] = {}
        absolute_candidates: dict[tuple[str, str], tuple[str, str]] = {}
        ambiguous_candidates: dict[str, str] = {}
        for ref, candidate_text in source_text_by_ref.items():
            relative = _relative_deadline_phrase(candidate_text)
            if relative:
                relative_candidates.setdefault(_normalize(relative), relative)
            for iso, phrase in _absolute_deadline_phrases(candidate_text):
                absolute_candidates.setdefault((iso, _normalize(phrase)), (iso, phrase))
            ambiguous = _ambiguous_deadline_phrase(candidate_text)
            if ambiguous:
                ambiguous_candidates.setdefault(_normalize(ambiguous), ambiguous)

        action = {
            "title": str(fact["title"]),
            "assignee": fact["assignee"],
            "deadline": None,
            "deadline_raw": None,
            "source_refs": refs,
        }
        if len(relative_candidates) == 1 and not absolute_candidates:
            phrase = next(iter(relative_candidates.values()))
            action["deadline_raw"] = phrase
        elif not relative_candidates and len(absolute_candidates) == 1:
            action["deadline"], action["deadline_raw"] = next(iter(absolute_candidates.values()))
        elif not relative_candidates and not absolute_candidates and len(ambiguous_candidates) == 1:
            action["deadline_raw"] = next(iter(ambiguous_candidates.values()))

        deadline_phrase = action["deadline_raw"]
        action["title"] = _trim_title_deadline_tail(action["title"], deadline_phrase)

        safe_model_titles = [
            title for _, title in sorted(candidates[index], key=lambda item: item[0], reverse=True)
            if _claim_support_ratio(title, [evidence_text]) >= 0.75
        ]
        if safe_model_titles:
            action["title"] = _trim_title_deadline_tail(safe_model_titles[0], deadline_phrase)
        if action["title"]:
            normalized_actions.append(action)
    if normalized_actions != normalized.get("action_items", []):
        logger.info(
            "Rebuilt action items from verified assignment evidence: extracted=%d model_supplied=%d",
            len(normalized_actions),
            len(normalized.get("action_items", [])),
        )
    normalized["action_items"] = normalized_actions

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
