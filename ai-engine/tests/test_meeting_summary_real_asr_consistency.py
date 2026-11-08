"""Regression coverage against persisted ASR text, never the verified script."""

import json
from pathlib import Path
from uuid import UUID

import pytest

from app.schemas.local_llm import ContextEvidence
from app.schemas.meeting_summary import MeetingSummary, SCHEMA_VERSION
from app.services.meeting_summary_evidence import cross_field_consistency_issues
from app.services.meeting_summary_evidence import _has_assignment_cue
from app.services.meeting_summary_json import (
    SummaryErrorCode,
    SummaryValidationError,
    validate_summary_output,
)
from app.services.meeting_summary_normalization import normalize_summary_from_evidence


FIXTURE = Path(__file__).parent / "fixtures" / "persisted_asr_latest_job.json"
CLEAN_FIXTURE = Path(__file__).parent / "fixtures" / "controlled_clean_transcript.json"


def load_persisted_evidence():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    rows = [
        ContextEvidence(
            source_type="TRANSCRIPT",
            source_id=UUID(item["source_id"]),
            speaker_id=UUID(item["speaker_id"]) if item["speaker_id"] else None,
            start_time_ms=item["start_time_ms"],
            end_time_ms=item["end_time_ms"],
            text=item["text"],
        )
        for item in data["evidence"]
    ]
    return data, rows


def load_clean_evidence():
    data = json.loads(CLEAN_FIXTURE.read_text(encoding="utf-8"))
    rows = [
        ContextEvidence(
            source_type=item["sourceType"],
            source_id=UUID(item["sourceId"]),
            speaker_id=UUID(item["speakerId"]) if item["speakerId"] else None,
            start_time_ms=item["startTimeMs"],
            end_time_ms=item["endTimeMs"],
            text=item["text"],
        )
        for item in data["evidence"]
    ]
    return rows


def load_three_speaker_evidence():
    data = json.loads((Path(__file__).parent / "fixtures" / "persisted_asr_job_96f3f050.json").read_text(encoding="utf-8"))
    rows = [
        ContextEvidence(
            source_type="TRANSCRIPT",
            source_id=UUID(item["source_id"]),
            speaker_id=UUID(item["speaker_id"]) if item["speaker_id"] else None,
            start_time_ms=item["start_time_ms"],
            end_time_ms=item["end_time_ms"],
            text=item["text"],
        )
        for item in data["evidence"]
    ]
    return data, rows


def generated_result(rows):
    refs = [row.source_ref for row in rows]
    s3, s4, s5, s6, s7 = (rows[index].source_ref for index in (2, 3, 4, 5, 6))
    return {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": (
            "Ngày 10 tháng 11 năm 2026, nhóm Smartread sẽ hoàn thành dự án với "
            "PostgreSQL làm cơ sở dữ liệu và React phát triển giao diện. "
            "Hùng phụ trách kiểm thử chức năng blog video và báo cáo kết quả được ngày 12 tháng 11 năm 2026. "
            "Lan phụ trách phát triển giao diện đăng nhập và hoàn thành được thứ 6. "
            "Nhiệm vụ còn lại sẽ được nhóm kiểm tra trong cuộc họp tiếp theo."
        ),
        "executive_summary_refs": refs,
        "key_points": [
            {"text": "Ngày 10 tháng 11 năm 2026, dự án Smartread sẽ hoàn thành.", "kind": "DISCUSSION", "source_refs": [s5]},
            {"text": "Hùng phụ trách kiểm thử chức năng blog video và báo cáo kết quả ngày 12 tháng 11 năm 2026.", "kind": "DISCUSSION", "source_refs": [s6]},
            {"text": "Lan phụ trách phát triển giao diện đăng nhập và hoàn thành thứ 6.", "kind": "DISCUSSION", "source_refs": [s3]},
        ],
        "decisions": [],
        "action_items": [
            {"title": "Thiết kế cơ sở dữ liệu", "assignee": None, "deadline": None,
             "deadline_raw": "thứ 6", "source_refs": [s3]},
            {"title": "Phát triển giao diện đăng nhập", "assignee": "Lan", "deadline": None,
             "deadline_raw": None, "source_refs": [s4]},
            {"title": "Kiểm thử chức năng blog video và báo cáo kết quả", "assignee": "Hùng",
             "deadline": "2026-11-12", "deadline_raw": "ngày 12 tháng 11 năm 2026", "source_refs": [s6]},
        ],
        "open_issues": [],
        "next_steps": [
            {"text": "Nhóm sẽ kiểm tra tiến độ trong cuộc họp tiếp theo.", "source_refs": [s7]},
        ],
        "conflicts": [],
    }


def strict_validate(payload, rows):
    return validate_summary_output(
        json.dumps(payload, ensure_ascii=False),
        MeetingSummary,
        {row.source_ref for row in rows},
        rows,
    )


def test_actual_persisted_asr_normalizes_to_consistent_grounded_result():
    fixture, rows = load_persisted_evidence()
    assert fixture["job_id"] == "ef20dcfe-c72b-4e05-abf5-a1d50a6dd9bf"
    result = normalize_summary_from_evidence(generated_result(rows), rows)
    validated = strict_validate(result, rows)

    assert len(rows) == 8
    assert [(item.title, item.assignee, item.deadline_raw, item.deadline) for item in validated.action_items] == [
        ("Thiết kế cơ sở dữ liệu", None, "thứ 6", None),
        ("Phát triển giao diện đăng nhập", "Lan", None, None),
        ("Kiểm thử chức năng blog video và báo cáo kết quả", "Hùng", "ngày 12 tháng 11 năm 2026", "2026-11-12"),
    ]
    assert "dự án Smartread sẽ hoàn thành" not in validated.executive_summary
    assert "thứ 6" in validated.executive_summary
    assert "ngày 12 tháng 11 năm 2026" in validated.executive_summary
    assert validated.decisions == []
    assert validated.key_points == []
    assert validated.next_steps == []
    assert len(validated.open_issues) == 1
    assert "ngày 10 tháng 11 năm 2026" in validated.open_issues[0].text
    assert "chưa xác định rõ" in validated.open_issues[0].text
    assert validated.open_issues[0].source_refs == [rows[3].source_ref, rows[4].source_ref]
    assert all(ref in {row.source_ref for row in rows} for ref in validated.executive_summary_refs)


def test_clean_transcript_keeps_explicit_task_dates_and_confirmed_decision():
    rows = load_clean_evidence()
    refs = [row.source_ref for row in rows]
    payload = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": None,
        "executive_summary_refs": [],
        "key_points": [],
        "decisions": [],
        "action_items": [
            {"title": "Thiết kế cơ sở dữ liệu", "assignee": "Minh", "deadline": None,
             "deadline_raw": None, "source_refs": [refs[0]]},
            {"title": "Phát triển giao diện đăng nhập", "assignee": "Lan", "deadline": None,
             "deadline_raw": None, "source_refs": [refs[2]]},
            {"title": "Kiểm thử chức năng upload video và báo cáo kết quả", "assignee": "Hùng",
             "deadline": None, "deadline_raw": None, "source_refs": [refs[4]]},
        ],
        "open_issues": [],
        "next_steps": [{"text": rows[6].text, "source_refs": [refs[6]]}],
        "conflicts": [],
    }
    normalized = normalize_summary_from_evidence(payload, rows)
    validated = strict_validate(normalized, rows)

    assert [(item.assignee, item.deadline, item.deadline_raw) for item in validated.action_items] == [
        ("Minh", None, "trước thứ Sáu"),
        ("Lan", "2026-11-10", "ngày 10 tháng 11 năm 2026"),
        ("Hùng", "2026-11-12", "ngày 12 tháng 11 năm 2026"),
    ]
    assert len(validated.decisions) == 1
    assert "PostgreSQL" in validated.decisions[0].text
    assert "React" in validated.decisions[0].text
    assert len(validated.next_steps) == 1


def test_project_deadline_and_wrong_task_citation_are_rejected_without_normalization():
    _, rows = load_persisted_evidence()
    result = generated_result(rows)
    result["action_items"][1]["source_refs"] = [rows[2].source_ref]
    issues = cross_field_consistency_issues(result, rows)
    issue_types = {item["type"] for item in issues}
    assert "project_deadline_inferred_from_task" in issue_types
    assert "unsupported_action_title" in issue_types
    assert "summary_action_deadline_mismatch" in issue_types

    with pytest.raises(SummaryValidationError) as error:
        strict_validate(result, rows)
    assert error.value.code == SummaryErrorCode.EVIDENCE_CONSISTENCY_ERROR


def test_corrupted_asr_technology_mention_does_not_support_a_confirmed_summary_claim():
    _, rows = load_persisted_evidence()
    s2 = rows[1].source_ref
    result = generated_result(rows)
    result["executive_summary"] = "The team agreed to use PostgreSQL and React."
    result["executive_summary_refs"] = [s2]

    assert "unsupported_summary_decision" in {
        item["type"] for item in cross_field_consistency_issues(result, rows)
    }
    with pytest.raises(SummaryValidationError) as error:
        strict_validate(result, rows)
    assert error.value.code == SummaryErrorCode.EVIDENCE_CONSISTENCY_ERROR


def test_three_speaker_persisted_asr_recognizes_commitments_without_guessing_names_or_dates():
    fixture, rows = load_three_speaker_evidence()
    assert fixture["job_id"] == "96f3f050-3724-417d-8c3d-e16ef4b32330"
    assert len(rows) == 15
    refs = [row.source_ref for row in rows]

    payload = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Dự án Smart Rec sẽ hoàn thành ngày 16 tháng 11 năm 2026.",
        "executive_summary_refs": refs,
        "key_points": [],
        "decisions": [],
        "action_items": [
            {"title": "Kết nối giao diện quản lý cuộc họp với Backend", "assignee": "Mình",
             "deadline": "2026-11-16", "deadline_raw": "ngày 16 tháng 11 năm 2026", "source_refs": [refs[5]]},
            {"title": "Kiểm thử chức năng upload video và kiểm tra kết quả transcript", "assignee": "Hùng",
             "deadline": None, "deadline_raw": None, "source_refs": [refs[6]]},
            {"title": "Thiết kế và tối ưu cơ sở dữ liệu PostgreSQL", "assignee": "Minh",
             "deadline": "2026-11-06", "deadline_raw": "thứ Sáu", "source_refs": [refs[7]]},
            {"title": "Kiểm thử tính năng bấm vào Evidence để chuyển audio đến đúng thời điểm", "assignee": "Hùng",
             "deadline": "2026-11-14", "deadline_raw": "ngày 14 tháng 11 năm 2026", "source_refs": [refs[9]]},
            {"title": "Báo cáo kết quả", "assignee": "Hùng",
             "deadline": "2026-11-16", "deadline_raw": "ngày 16 tháng 11 năm 2026", "source_refs": [refs[10]]},
        ],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }

    normalized = normalize_summary_from_evidence(payload, rows)
    validated = strict_validate(normalized, rows)

    assert [(item.assignee, item.deadline, item.deadline_raw) for item in validated.action_items] == [
        (None, "2026-11-10", "trước ngày 10 tháng 11 năm 2026"),
        (None, "2026-11-12", "ngày 12 tháng 11 năm 2026"),
        (None, "2026-11-13", "trước ngày 13 tháng 11 năm 2026"),
        (None, None, None),
        (None, "2026-11-14", "vào ngày 14 tháng 11 năm 2026"),
    ]
    assert "dự án Smart Rec sẽ hoàn thành" not in validated.executive_summary.casefold()
    assert "16 tháng 11 năm 2026" not in validated.executive_summary
    assert len(validated.decisions) == 3
    assert "thống nhất tiếp tục sử dụng PostgreSQL" in validated.decisions[0].text
    assert "Mình đồng ý với quyết định đó" in validated.decisions[2].text
    assert all(ref in {row.source_ref for row in rows} for item in validated.action_items for ref in item.source_refs)


def test_three_speaker_progress_and_acceptance_lines_are_not_assignments():
    _, rows = load_three_speaker_evidence()
    for index in (1, 2, 8, 11, 12, 13, 14):
        assert not _has_assignment_cue(rows[index].text)

    for index in (5, 6, 7, 9, 10):
        assert _has_assignment_cue(rows[index].text)


def test_executive_summary_rebuild_excludes_action_items_without_evidence_support():
    from uuid import UUID

    evidence = ContextEvidence(
        source_type="TRANSCRIPT",
        source_id=UUID("10000000-0000-4000-8000-000000000099"),
        start_time_ms=1000,
        end_time_ms=3000,
        text="Nhóm đang thảo luận kế hoạch tiếp theo của dự án.",
    )
    payload = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Dự án SmartRec sẽ hoàn thành vào ngày 10 tháng 11 năm 2026.",
        "executive_summary_refs": [evidence.source_ref],
        "key_points": [],
        "decisions": [],
        "action_items": [{
            "title": "Thiết kế cơ sở dữ liệu",
            "assignee": "Minh",
            "deadline": "2026-11-10",
            "deadline_raw": "ngày 10 tháng 11 năm 2026",
            "source_refs": [evidence.source_ref],
        }],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }

    normalized = normalize_summary_from_evidence(payload, [evidence])

    assert normalized["executive_summary"] is None
    assert normalized["executive_summary_refs"] == []
    assert normalized["action_items"] == payload["action_items"]
    with pytest.raises(SummaryValidationError) as error:
        strict_validate(normalized, [evidence])
    assert error.value.code == SummaryErrorCode.EVIDENCE_CONSISTENCY_ERROR
