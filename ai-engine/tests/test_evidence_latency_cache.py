
"""Regression tests for request-scoped Evidence text caching."""

from uuid import UUID

from app.schemas.local_llm import ContextEvidence
from app.schemas.meeting_summary import SCHEMA_VERSION
from app.services.meeting_summary_pipeline import (
    normalize_and_validate_local_summary,
)
from app.services.meeting_summary_evidence import (
    evidence_consistency_issues,
)
import json


def _case(texts, action_refs, *, assignee="Minh", deadline=None):
    evidence = []

    for index, text in enumerate(texts):
        evidence.append(ContextEvidence(
            source_type="TRANSCRIPT",
            source_id=UUID(
                f"10000000-0000-4000-8000-{index + 41:012x}"
            ),
            speaker_id=None,
            start_time_ms=index * 4000 + 1000,
            end_time_ms=index * 4000 + 3000,
            text=text,
        ))

    refs = [f"S{i + 1}" for i in range(len(evidence))]

    raw = json.dumps({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": texts[0],
        "executive_summary_refs": ["S1"],
        "key_points": [],
        "decisions": [],
        "action_items": [{
            "title": "Thiết kế cơ sở dữ liệu",
            "assignee": assignee,
            "deadline": deadline,
            "deadline_raw": None,
            "source_refs": action_refs,
        }],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }, ensure_ascii=False)

    summary = normalize_and_validate_local_summary(
        raw, refs, evidence
    )

    return summary, evidence


def test_repeated_requests_produce_identical_diagnostics():
    summary, evidence = _case(
        [
            "Minh phụ trách thiết kế cơ sở dữ liệu.",
            "Hạn hoàn thành là ngày 20/11/2026.",
        ],
        ["S1"],
    )

    first = evidence_consistency_issues(summary, evidence)
    second = evidence_consistency_issues(summary, evidence)

    assert first == second


def test_different_evidence_does_not_reuse_previous_request_cache():
    first_summary, first_evidence = _case(
        ["Minh phụ trách thiết kế cơ sở dữ liệu."],
        ["S1"],
    )
    second_summary, second_evidence = _case(
        ["Minh không phụ trách thiết kế cơ sở dữ liệu."],
        ["S1"],
    )

    first_result = evidence_consistency_issues(
        first_summary, first_evidence
    )
    second_result = evidence_consistency_issues(
        second_summary, second_evidence
    )

    assert first_result == evidence_consistency_issues(
        first_summary, first_evidence
    )
    assert second_result == evidence_consistency_issues(
        second_summary, second_evidence
    )


def test_duplicate_text_distinct_source_ids_is_stable():
    summary, evidence = _case(
        [
            "Minh phụ trách thiết kế cơ sở dữ liệu.",
            "Minh phụ trách thiết kế cơ sở dữ liệu.",
        ],
        ["S1"],
    )

    expected = evidence_consistency_issues(
        summary, evidence
    )

    assert expected == evidence_consistency_issues(
        summary, list(evidence)
    )


def test_adjacent_deadline_diagnostics_are_stable():
    summary, evidence = _case(
        [
            "Minh phụ trách thiết kế cơ sở dữ liệu.",
            "Hạn hoàn thành là ngày 20/11/2026.",
        ],
        ["S1"],
        deadline=None,
    )

    expected = evidence_consistency_issues(
        summary, evidence
    )

    assert expected == evidence_consistency_issues(
        summary, evidence
    )


def test_cache_preserves_explicit_expected_diagnostics():
    """Regression must reject unsupported claims, not just remain stable."""
    summary, evidence = _case(
        ["Minh phụ trách thiết kế cơ sở dữ liệu."],
        ["S1"],
    )

    original_item = summary.action_items[0]

    wrong_assignee = summary.model_copy(
        update={
            "action_items": [
                original_item.model_copy(
                    update={"assignee": "Lan"}
                )
            ]
        }
    )

    actual = evidence_consistency_issues(
        wrong_assignee, evidence
    )

    assert actual == (
        {
            "loc": ["action_items", 0, "assignee"],
            "type": "unsupported_assignee",
        },
    )


def test_cache_preserves_missing_assignment_diagnostic():
    """An omitted explicit assignment must still be detected."""
    summary, evidence = _case(
        ["Minh phụ trách thiết kế cơ sở dữ liệu."],
        ["S1"],
    )

    missing_actions = summary.model_copy(
        update={"action_items": []}
    )

    actual = evidence_consistency_issues(
        missing_actions, evidence
    )

    assert actual == (
        {
            "loc": ["action_items"],
            "type": "missing_explicit_assignment",
        },
    )


def test_repeated_deadline_text_uses_request_scoped_cache():
    """The same candidate text should not be reanalyzed per action."""
    import sys
    import app.services.meeting_summary_evidence as evidence_module

    summary, evidence = _case(
        [
            "Minh phụ trách thiết kế cơ sở dữ liệu.",
            "Hạn hoàn thành là ngày 20/11/2026.",
        ],
        ["S1"],
    )

    # Multiple action items cite the same assignment evidence.
    # All invoke deadline linking on the same neighboring segment.
    repeated_actions = [
        summary.action_items[0].model_copy()
        for _ in range(8)
    ]

    summary = summary.model_copy(
        update={"action_items": repeated_actions}
    )

    assignment_code = evidence_module._has_assignment_cue.__code__
    normalize_code = evidence_module._normalize.__code__
    deadline_code = evidence_module._deadline_refs_are_linked.__code__

    counts = {
        "assignment_from_deadline": 0,
        "normalize_from_deadline": 0,
    }

    def profiler(frame, event, arg):
        if event != "call":
            return

        if frame.f_code is assignment_code:
            if frame.f_back and frame.f_back.f_code is deadline_code:
                counts["assignment_from_deadline"] += 1
        elif frame.f_code is normalize_code:
            if frame.f_back and frame.f_back.f_code is deadline_code:
                counts["normalize_from_deadline"] += 1

    previous_profiler = sys.getprofile()

    try:
        sys.setprofile(profiler)
        result = evidence_consistency_issues(
            summary, evidence
        )
    finally:
        sys.setprofile(previous_profiler)

    assert isinstance(result, tuple)

    # Eight actions share the same neighboring deadline Evidence.
    # The original helper should analyze that text once per request,
    # not once per action.
    assert counts["assignment_from_deadline"] == 1
    assert counts["normalize_from_deadline"] == 1


def test_concurrent_requests_preserve_expected_diagnostics():
    """Concurrent assessments must preserve independent expected outputs."""
    from concurrent.futures import ThreadPoolExecutor

    summary, evidence = _case(
        ["Minh phụ trách thiết kế cơ sở dữ liệu."],
        ["S1"],
    )

    first = summary.action_items[0]

    cases = [
        (
            summary,
            (),
        ),
        (
            summary.model_copy(update={
                "action_items": [
                    first.model_copy(update={"assignee": "Lan"})
                ]
            }),
            (
                {
                    "loc": ["action_items", 0, "assignee"],
                    "type": "unsupported_assignee",
                },
            ),
        ),
        (
            summary.model_copy(update={"action_items": []}),
            (
                {
                    "loc": ["action_items"],
                    "type": "missing_explicit_assignment",
                },
            ),
        ),
        (
            summary.model_copy(update={
                "action_items": [
                    first.model_copy(
                        update={"deadline": "2026-12-31"}
                    )
                ]
            }),
            (
                {
                    "loc": ["action_items", 0, "deadline"],
                    "type": "unsupported_absolute_deadline",
                },
            ),
        ),
    ]

    def evaluate(case):
        candidate, expected = case
        actual = evidence_consistency_issues(
            candidate, evidence
        )
        assert actual == expected
        return True

    requests = cases * 6

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(evaluate, requests))

    assert len(results) == 24
    assert all(results)


def test_deadline_linking_edge_cases_with_expected_results():
    """Deadline-linking rules must retain explicit boundary behavior."""
    from app.services.meeting_summary_evidence import (
        _deadline_refs_are_linked,
        _normalize,
    )

    assignment_text = "Minh phụ trách thiết kế cơ sở dữ liệu."
    deadline_text = "Hạn hoàn thành là ngày 20/11/2026."

    def segment(text, start, end):
        return {
            "text": text,
            "start_time_ms": start,
            "end_time_ms": end,
        }

    cases = [
        ("adjacent_zero", deadline_text, 0, ["S1", "S2"], True),
        ("gap_5000", deadline_text, 5000, ["S1", "S2"], True),
        ("gap_5001", deadline_text, 5001, ["S1", "S2"], False),
        ("reverse_order", deadline_text, 0, ["S2", "S1"], False),
        ("not_adjacent", deadline_text, 0, ["S1", "X", "S2"], False),
        (
            "unicode_unaccented",
            "Han hoan thanh la ngay 20/11/2026.",
            0,
            ["S1", "S2"],
            True,
        ),
        (
            "new_assignment",
            "Lan phụ trách báo cáo, hạn 20/11/2026.",
            0,
            ["S1", "S2"],
            False,
        ),
        (
            "negated_assignment",
            "Lan không phụ trách báo cáo, hạn 20/11/2026.",
            0,
            ["S1", "S2"],
            True,
        ),
    ]

    for name, text, gap, order, expected in cases:
        by_ref = {
            "S1": segment(assignment_text, 0, 1000),
            "S2": segment(text, 1000 + gap, 2000 + gap),
        }

        uncached = _deadline_refs_are_linked(
            "S2", {"S1"}, by_ref, order
        )

        cached = _deadline_refs_are_linked(
            "S2", {"S1"}, by_ref, order,
            text_feature_cache={}
        )

        assert uncached is expected, name
        assert cached is expected, name

    assert (
        _normalize("ĐƯỢC GIAO")
        == _normalize("được giao")
        == _normalize("DUOC GIAO")
        == "duoc giao"
    )

    # Same text, different source IDs and timestamp positions.
    # Text features may be shared; linking decisions must not be.
    by_ref = {
        "S1": segment(assignment_text, 0, 1000),
        "S2": segment(deadline_text, 1000, 2000),
        "S3": segment(deadline_text, 8000, 9000),
    }

    cache = {}
    order = ["S1", "S2", "S3"]

    assert _deadline_refs_are_linked(
        "S2", {"S1"}, by_ref, order,
        text_feature_cache=cache
    ) is True

    assert _deadline_refs_are_linked(
        "S3", {"S1"}, by_ref, order,
        text_feature_cache=cache
    ) is False

    assert len(cache) == 1
