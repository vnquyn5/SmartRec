"""Grounding tests for assignments, dates, and decisions."""

import json
from uuid import UUID

import pytest

from app.schemas.meeting_summary import ClassificationExtraction, MeetingSummary, SCHEMA_VERSION
from app.schemas.local_llm import ContextEvidence
from app.services.meeting_summary_json import (
    SummaryErrorCode,
    SummaryValidationError,
    validate_summary_output,
)
from app.services.meeting_summary_normalization import normalize_summary_from_evidence
from app.services.meeting_summary_evidence import (
    _has_assignment_cue,
    cross_field_consistency_issues,
    extract_explicit_assignment_facts,
)


def evidence(ref: str, text: str, start: int, end: int, speaker: str | None = None):
    return ContextEvidence(
        source_type="TRANSCRIPT",
        source_id=UUID(ref),
        speaker_id=UUID(speaker) if speaker else None,
        start_time_ms=start,
        end_time_ms=end,
        text=text,
    )


def action(title, assignee, deadline, deadline_raw, refs):
    return {
        "action_items": [{
            "title": title,
            "assignee": assignee,
            "deadline": deadline,
            "deadline_raw": deadline_raw,
            "source_refs": refs,
        }]
    }


def validate_action(payload, rows):
    return validate_actions(payload["action_items"], rows)


def validate_actions(action_items, rows):
    refs = {row.source_ref for row in rows}
    summary = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": None,
        "executive_summary_refs": [],
        "key_points": [],
        "decisions": [],
        "action_items": action_items,
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }
    return validate_summary_output(
        json.dumps(summary, ensure_ascii=False),
        MeetingSummary,
        refs,
        rows,
    )


def expect_evidence_error(payload, rows, error_type=None):
    with pytest.raises(SummaryValidationError) as error:
        validate_action(payload, rows)
    assert error.value.code == SummaryErrorCode.EVIDENCE_CONSISTENCY_ERROR
    if error_type:
        assert error_type in {diagnostic["type"] for diagnostic in error.value.validation_diagnostics}


def normalize_and_validate(payload, rows):
    normalized = normalize_summary_from_evidence(payload, rows)
    return validate_summary_output(
        json.dumps(normalized, ensure_ascii=False),
        MeetingSummary,
        {row.source_ref for row in rows},
        rows,
    )


def test_explicit_vietnamese_assignment_and_named_assignee_pass():
    task = evidence(
        "10000000-0000-4000-8000-000000000001",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        1000,
        2200,
    )

    result = validate_action(
        action("Phát triển giao diện đăng nhập", "Lan", None, None, [task.source_ref]),
        [task],
    )

    assert result.action_items[0].assignee == "Lan"


def test_explicit_named_assignee_cannot_be_dropped():
    task = evidence(
        "10000000-0000-4000-8000-000000000022",
        "Hùng phụ trách kiểm thử video.",
        22000,
        28000,
    )
    expect_evidence_error(
        action("Kiểm thử video", None, None, None, [task.source_ref]),
        [task],
        "missing_explicit_assignee",
    )


def test_bare_obligation_uses_shared_assignment_extraction_and_validation():
    task = evidence(
        "10000000-0000-4000-8000-000000000099",
        "Hùng phải kiểm thử video.",
        1000,
        2000,
    )

    assert _has_assignment_cue(task.text)
    result = normalize_and_validate({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": None,
        "executive_summary_refs": [],
        "key_points": [],
        "decisions": [],
        "action_items": [],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }, [task])
    assert len(result.action_items) == 1
    assert result.action_items[0].title == "kiểm thử video"
    assert result.action_items[0].assignee == "Hùng"


def test_vietnamese_duoc_giao_cue_supports_named_assignee():
    task = evidence(
        "10000000-0000-4000-8000-000000000031",
        "Lan được giao kiểm thử video.",
        1000,
        2200,
    )
    result = validate_action(
        action("Kiểm thử video", "Lan", None, None, [task.source_ref]),
        [task],
    )
    assert result.action_items[0].assignee == "Lan"


def test_first_person_responsibility_keeps_assignee_unknown_and_relative_date_raw():
    task = evidence(
        "10000000-0000-4000-8000-000000000002",
        "Mình chịu trách nhiệm thiết kế cơ sở dữ liệu và phải hoàn thành trước thứ Sáu.",
        1000,
        4000,
        speaker="20000000-0000-4000-8000-000000000002",
    )

    result = validate_action(
        action("Thiết kế cơ sở dữ liệu", None, None, "trước thứ Sáu", [task.source_ref]),
        [task],
    )

    assert result.action_items[0].assignee is None
    assert result.action_items[0].deadline is None


@pytest.mark.parametrize(("ref", "text", "title"), [
    (
        "10000000-0000-4000-8000-000000000070",
        "Mình nhận nhiệm vụ kiểm thử chức năng upload video.",
        "Kiểm thử chức năng upload video",
    ),
    (
        "10000000-0000-4000-8000-000000000071",
        "Tôi sẽ hoàn thành việc kết nối API.",
        "Hoàn thành việc kết nối API",
    ),
    (
        "10000000-0000-4000-8000-000000000072",
        "Tôi chịu trách nhiệm sửa lỗi đăng nhập.",
        "Sửa lỗi đăng nhập",
    ),
])
def test_explicit_first_person_responsibility_is_a_task_with_unknown_name(ref, text, title):
    task = evidence(ref, text, 1000, 5000)
    result = validate_action(
        action(title, None, None, None, [task.source_ref]),
        [task],
    )
    assert result.action_items[0].assignee is None


def test_negated_first_person_acceptance_is_not_an_assignment():
    assert not _has_assignment_cue("Mình chưa nhận nhiệm vụ kiểm thử video.")


def test_combined_summary_can_list_multiple_task_deadlines_without_false_mismatch():
    lan = evidence(
        "10000000-0000-4000-8000-000000000073",
        "Lan phụ trách phát triển giao diện đăng nhập trước ngày 10 tháng 11 năm 2026.",
        1000,
        5000,
    )
    hung = evidence(
        "10000000-0000-4000-8000-000000000074",
        "Hùng phụ trách kiểm thử upload video trước ngày 12 tháng 11 năm 2026.",
        6000,
        10000,
    )
    summary = {
        "executive_summary": (
            "Lan phụ trách phát triển giao diện đăng nhập trước ngày 10 tháng 11 năm 2026 "
            "và Hùng phụ trách kiểm thử upload video trước ngày 12 tháng 11 năm 2026."
        ),
        "executive_summary_refs": [lan.source_ref, hung.source_ref],
        "action_items": [
            {
                "title": "Phát triển giao diện đăng nhập",
                "assignee": "Lan",
                "deadline": "2026-11-10",
                "deadline_raw": "trước ngày 10 tháng 11 năm 2026",
                "source_refs": [lan.source_ref],
            },
            {
                "title": "Kiểm thử upload video",
                "assignee": "Hùng",
                "deadline": "2026-11-12",
                "deadline_raw": "trước ngày 12 tháng 11 năm 2026",
                "source_refs": [hung.source_ref],
            },
        ],
        "key_points": [],
        "next_steps": [],
        "open_issues": [],
    }

    issues = cross_field_consistency_issues(summary, [lan, hung])
    assert "summary_action_deadline_mismatch" not in {item["type"] for item in issues}

    summary["executive_summary"] = summary["executive_summary"].replace(
        "Lan phụ trách phát triển giao diện đăng nhập trước ngày 10 tháng 11 năm 2026 "
        "và Hùng phụ trách kiểm thử upload video trước ngày 12 tháng 11 năm 2026",
        "Lan phụ trách phát triển giao diện đăng nhập trước ngày 12 tháng 11 năm 2026 "
        "và Hùng phụ trách kiểm thử upload video trước ngày 10 tháng 11 năm 2026",
    )
    issues = cross_field_consistency_issues(summary, [lan, hung])
    assert "summary_action_deadline_mismatch" in {item["type"] for item in issues}


def test_adjacent_deadline_sentence_can_link_to_immediately_preceding_assignment():
    task = evidence(
        "10000000-0000-4000-8000-000000000003",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        15980,
        17880,
    )
    deadline = evidence(
        "10000000-0000-4000-8000-000000000004",
        "Hạn hoàn thành là ngày 10 tháng 11 năm 2026.",
        18780,
        21280,
    )

    result = validate_action(
        action(
            "Phát triển giao diện đăng nhập",
            "Lan",
            "2026-11-10",
            None,
            [task.source_ref, deadline.source_ref],
        ),
        [task, deadline],
    )

    assert result.action_items[0].deadline == "2026-11-10"
    assert result.action_items[0].source_refs == [task.source_ref, deadline.source_ref]


def test_deadline_before_assignment_is_not_borrowed_by_the_next_task():
    earlier_deadline = evidence(
        "10000000-0000-4000-8000-000000000048",
        "Hạn hoàn thành là ngày 10 tháng 11 năm 2026.",
        1000,
        2200,
    )
    next_task = evidence(
        "10000000-0000-4000-8000-000000000049",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        2300,
        4000,
    )

    expect_evidence_error(
        action(
            "Phát triển giao diện đăng nhập",
            "Lan",
            "2026-11-10",
            "ngày 10 tháng 11 năm 2026",
            [earlier_deadline.source_ref, next_task.source_ref],
        ),
        [earlier_deadline, next_task],
        "unsupported_absolute_deadline",
    )


def test_ambiguous_adjacent_date_is_not_linked_but_hung_date_is_supported():
    lan = evidence(
        "10000000-0000-4000-8000-000000000026",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        15980,
        17880,
    )
    lan_date = evidence(
        "10000000-0000-4000-8000-000000000027",
        "Hạt hoàn thành là ngày 10 tháng 11 năm 2026.",
        18780,
        21280,
    )
    hung = evidence(
        "10000000-0000-4000-8000-000000000028",
        "Hùng phụ trách kiểm thử chức năng của blog video và phải báo cáo kết quả được ngày 12 tháng 11 năm 2026.",
        22200,
        28200,
    )
    rows = [lan, lan_date, hung]

    result = validate_actions(
        [
            {
                "title": "Phát triển giao diện đăng nhập",
                "assignee": "Lan",
                "deadline": None,
                "deadline_raw": None,
                "source_refs": [lan.source_ref],
            },
            {
                "title": "Kiểm thử chức năng blog video và báo cáo kết quả",
                "assignee": "Hùng",
                "deadline": "2026-11-12",
                "deadline_raw": None,
                "source_refs": [hung.source_ref],
            },
        ],
        rows,
    )

    assert [(item.assignee, item.deadline) for item in result.action_items] == [
        ("Lan", None),
        ("Hùng", "2026-11-12"),
    ]


def test_ambiguous_asr_date_segment_does_not_support_adjacent_task_deadline():
    task = evidence(
        "10000000-0000-4000-8000-000000000023",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        15980,
        17880,
    )
    deadline = evidence(
        "10000000-0000-4000-8000-000000000024",
        "Hạt hoàn thành là ngày 10 tháng 11 năm 2026.",
        18780,
        21280,
    )

    expect_evidence_error(
        action(
            "Phát triển giao diện đăng nhập",
            "Lan",
            "2026-11-10",
            None,
            [task.source_ref, deadline.source_ref],
        ),
        [task, deadline],
        "unsupported_absolute_deadline",
    )


def test_hung_task_with_explicit_full_calendar_date_passes():
    task = evidence(
        "10000000-0000-4000-8000-000000000005",
        "Hùng phụ trách kiểm thử chức năng blog video và phải báo cáo kết quả ngày 12 tháng 11 năm 2026.",
        22000,
        28200,
    )

    result = validate_action(
        action("Kiểm thử blog video và báo cáo kết quả", "Hùng", "2026-11-12", None, [task.source_ref]),
        [task],
    )

    assert result.action_items[0].deadline == "2026-11-12"


def test_speaker_id_does_not_support_an_inferred_named_assignee():
    task = evidence(
        "10000000-0000-4000-8000-000000000006",
        "Mình chịu trách nhiệm thiết kế cơ sở dữ liệu.",
        10820,
        14700,
        speaker="20000000-0000-4000-8000-000000000006",
    )

    expect_evidence_error(
        action("Thiết kế cơ sở dữ liệu", "Minh", None, None, [task.source_ref]),
        [task],
        "unsupported_assignee",
    )


def test_general_progress_review_is_not_an_assigned_action_item():
    review = evidence(
        "10000000-0000-4000-8000-000000000007",
        "Cuối cùng nhóm sẽ kiểm tra tiến độ trong cuộc họp tiếp theo.",
        28700,
        33400,
    )

    expect_evidence_error(
        action("Kiểm tra tiến độ", None, None, "cuộc họp tiếp theo", [review.source_ref]),
        [review],
        "unassigned_action_item",
    )


def test_normalization_drops_only_unassigned_progress_review():
    review = evidence(
        "10000000-0000-4000-8000-000000000087",
        "Nhóm sẽ kiểm tra tiến độ trong cuộc họp tiếp theo.",
        1000, 2000,
    )
    summary = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Nhóm sẽ kiểm tra tiến độ trong cuộc họp tiếp theo.",
        "executive_summary_refs": [review.source_ref],
        "key_points": [], "decisions": [],
        "action_items": [{
            "title": "Kiểm tra tiến độ", "assignee": None,
            "deadline": None, "deadline_raw": None,
            "source_refs": [review.source_ref],
        }],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }
    result = normalize_and_validate(summary, [review])
    assert result.action_items == []
    assert result.executive_summary == summary["executive_summary"]


def test_normalization_drops_asr_corrupted_unassigned_progress_review():
    review = evidence(
        "10000000-0000-4000-8000-000000000089",
        "Cuối cùng nhóm thỏng nhân nhất kiểm tra tiến đấu trong cuộc họp tiếp theo.",
        1000, 3000,
    )
    summary = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Nhóm kiểm tra tiến độ trong cuộc họp tiếp theo.",
        "executive_summary_refs": [review.source_ref],
        "key_points": [], "decisions": [],
        "action_items": [{
            "title": "Kiểm tra tiến độ", "assignee": None,
            "deadline": None, "deadline_raw": None,
            "source_refs": [review.source_ref],
        }],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }
    result = normalize_and_validate(summary, [review])
    assert result.action_items == []
    assert not _has_assignment_cue(review.text)


def test_normalization_recovers_missing_explicit_named_tasks_without_progress_items():
    lan = evidence(
        "10000000-0000-4000-8000-000000000090",
        "Lan sẽ phải phát triển giao diện đăng nhập.", 1000, 2000,
    )
    hung = evidence(
        "10000000-0000-4000-8000-000000000091",
        "Hùng phụ trách kiểm thử video trước ngày 12 tháng 11 năm 2026.", 2100, 4000,
    )
    review = evidence(
        "10000000-0000-4000-8000-000000000092",
        "Nhóm sẽ kiểm tra tiến độ trong cuộc họp tiếp theo.", 4100, 5200,
    )
    normalized = normalize_summary_from_evidence({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Lan phát triển giao diện và Hùng kiểm thử video.",
        "executive_summary_refs": [lan.source_ref, hung.source_ref],
        "key_points": [], "decisions": [], "action_items": [],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }, [lan, hung, review])
    result = validate_summary_output(
        json.dumps(normalized, ensure_ascii=False), MeetingSummary,
        {lan.source_ref, hung.source_ref, review.source_ref}, [lan, hung, review],
    )

    assert [(item.title, item.assignee, item.source_refs) for item in result.action_items] == [
        ("phát triển giao diện đăng nhập", "Lan", [lan.source_ref]),
        ("kiểm thử video", "Hùng", [hung.source_ref]),
    ]


def test_unsupported_action_title_is_replaced_only_from_its_single_cited_assignment():
    task = evidence(
        "10000000-0000-4000-8000-000000000093",
        "Lan sẽ phải phát triển giao diện đăng nhập.", 1000, 2000,
    )
    normalized = normalize_summary_from_evidence({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Lan sẽ phát triển giao diện đăng nhập.",
        "executive_summary_refs": [task.source_ref],
        "key_points": [], "decisions": [],
        "action_items": [{
            "title": "Xây dựng hệ thống tài khoản và bảo mật", "assignee": "Lan",
            "deadline": None, "deadline_raw": None, "source_refs": [task.source_ref],
        }],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }, [task])
    result = validate_summary_output(
        json.dumps(normalized, ensure_ascii=False), MeetingSummary,
        {task.source_ref}, [task],
    )

    assert result.action_items[0].title == "phát triển giao diện đăng nhập"


def test_unsupported_action_title_remains_rejected_without_safe_normalization():
    task = evidence(
        "10000000-0000-4000-8000-000000000094",
        "Lan sẽ phải phát triển giao diện đăng nhập.", 1000, 2000,
    )
    expect_evidence_error(
        action("Xây dựng hệ thống tài khoản và bảo mật", "Lan", None, None, [task.source_ref]),
        [task], "unsupported_action_title",
    )


def test_normalization_drops_action_claim_without_explicit_assignment_evidence():
    intention = evidence(
        "10000000-0000-4000-8000-000000000088",
        "Lan sẽ phát triển giao diện đăng nhập.", 1000, 2000,
    )
    summary = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Lan sẽ phát triển giao diện đăng nhập.",
        "executive_summary_refs": [intention.source_ref],
        "key_points": [], "decisions": [],
        "action_items": [{
            "title": "Phát triển giao diện đăng nhập", "assignee": "Lan",
            "deadline": None, "deadline_raw": None,
            "source_refs": [intention.source_ref],
        }],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }
    result = normalize_and_validate(summary, [intention])
    assert result.action_items == []


def test_shared_assignment_extractor_recovers_named_first_person_and_group_tasks():
    source = evidence(
        "10000000-0000-4000-8000-000000000096",
        "Vậy Hùng phụ trách kiểm thử nhận diện 6 người nói và báo cáo kết quả trước thứ 5 tuần sau. "
        "Mình sẽ kiểm tra lại giao diện. Hai bạn hoàn thành bản thử nghiệm trước thứ 2 của tuần kế tiếp.",
        1000,
        7000,
    )

    facts = extract_explicit_assignment_facts(source.text, source.source_ref)

    assert len(facts) == 3
    assert [fact["assignee"] for fact in facts] == ["Hùng", None, None]
    assert facts[0]["title"].startswith("kiểm thử nhận diện")
    assert facts[1]["title"].startswith("kiểm tra lại giao diện")
    assert facts[2]["title"].startswith("hoàn thành bản thử nghiệm")


def test_shared_assignment_extractor_ignores_negated_cue_when_other_task_is_affirmative():
    source = evidence(
        "10000000-0000-4000-8000-000000000095",
        "Không phụ trách kiểm thử API. Lan phụ trách phát triển giao diện đăng nhập.",
        1000,
        5000,
    )

    facts = extract_explicit_assignment_facts(source.text, source.source_ref)

    assert len(facts) == 1
    assert facts[0]["title"] == "phát triển giao diện đăng nhập"
    assert facts[0]["assignee"] == "Lan"


def test_normalizer_drops_unsupported_actions_and_recovers_explicit_assignments():
    source = evidence(
        "10000000-0000-4000-8000-000000000097",
        "Lan hỗ trợ kiểm tra API. Hai bạn hoàn thành bản thử nghiệm trước thứ 2 của tuần kế tiếp.",
        1000,
        5000,
    )
    unsupported = {
        "title": "Create a roadmap", "assignee": "Lan", "deadline": None,
        "deadline_raw": None, "source_refs": [source.source_ref],
    }
    summary = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": None,
        "executive_summary_refs": [],
        "key_points": [], "decisions": [], "action_items": [unsupported],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }

    normalized = normalize_summary_from_evidence(summary, [source])
    validated = normalize_and_validate(summary, [source])

    assert [(item["title"], item["assignee"], item["deadline_raw"])
            for item in normalized["action_items"]] == [
        ("kiểm tra API", "Lan", None),
        ("hoàn thành bản thử nghiệm", None, "trước thứ 2 của tuần kế tiếp"),
    ]
    assert len(validated.action_items) == 2
    assert validated.action_items[1].deadline is None


def test_explicit_assignment_in_ocr_evidence_is_kept_with_its_source_ref():
    source = ContextEvidence(
        source_type="SLIDE_OCR",
        source_id=UUID("10000000-0000-4000-8000-000000000098"),
        speaker_id=None,
        start_time_ms=1000,
        end_time_ms=2000,
        text="Lan phụ trách kiểm thử luồng đăng nhập trước thứ Sáu.",
    )

    result = normalize_and_validate({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": None,
        "executive_summary_refs": [],
        "key_points": [],
        "decisions": [],
        "action_items": [],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }, [source])

    assert len(result.action_items) == 1
    assert result.action_items[0].assignee == "Lan"
    assert result.action_items[0].source_refs == [source.source_ref]
    assert result.action_items[0].deadline_raw == "trước thứ Sáu"


def test_normalization_removes_unassigned_progress_review_as_action_citation():
    task = evidence(
        "10000000-0000-4000-8000-000000000050",
        "Hùng phụ trách kiểm thử upload video và phải báo cáo ngày 12 tháng 11 năm 2026.",
        1000,
        4000,
    )
    review = evidence(
        "10000000-0000-4000-8000-000000000051",
        "Nhóm sẽ kiểm tra tiến độ trong cuộc họp tiếp theo.",
        5000,
        7000,
    )
    result = normalize_and_validate({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Hùng kiểm thử upload video.",
        "executive_summary_refs": [task.source_ref],
        "key_points": [], "decisions": [],
        "action_items": [{
            "title": "Kiểm thử upload video và báo cáo kết quả",
            "assignee": "Hùng",
            "deadline": "2026-11-12",
            "deadline_raw": "ngày 12 tháng 11 năm 2026",
            "source_refs": [task.source_ref, review.source_ref],
        }],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }, [task, review])

    assert result.action_items[0].source_refs == [task.source_ref]


def test_unassigned_future_intention_is_not_an_assignment():
    intention = evidence(
        "10000000-0000-4000-8000-000000000008",
        "Lan sẽ phát triển giao diện đăng nhập.",
        1000,
        2200,
    )
    expect_evidence_error(
        action("Phát triển giao diện đăng nhập", "Lan", None, None, [intention.source_ref]),
        [intention],
        "unassigned_action_item",
    )


def test_explicit_assignment_omission_is_reported():
    task = evidence(
        "10000000-0000-4000-8000-000000000020",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        15980,
        17880,
    )
    expect_evidence_error({"action_items": []}, [task], "missing_explicit_assignment")


def test_contains_word_is_not_mistaken_for_vietnamese_negation():
    from app.services.meeting_summary_evidence import _has_assignment_cue

    assert _has_assignment_cue(
        "Mình chứa trách nhiệm thiết kế cơ sở dữ liệu và phải hoàn thành được thứ 6."
    )
    assert not _has_assignment_cue(
        "Mình chưa chịu trách nhiệm thiết kế cơ sở dữ liệu."
    )


def test_actual_asr_responsibility_claim_normalizes_without_inventing_assignee_or_date():
    ambiguous = evidence(
        "10000000-0000-4000-8000-000000000025",
        "Mình chứa trách nhiệm thiết kế cơ sở dữ liệu và phải hoàn thành được thứ 6.",
        10820,
        14700,
    )
    result = normalize_and_validate({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": None,
        "executive_summary_refs": [],
        "key_points": [],
        "decisions": [],
        "action_items": [{
            "title": "Thiết kế cơ sở dữ liệu",
            "assignee": "Người nói",
            "deadline": "2026-11-06",
            "deadline_raw": "thứ 6",
            "source_refs": [ambiguous.source_ref],
        }],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }, [ambiguous])

    item = result.action_items[0]
    assert item.assignee is None
    assert item.deadline is None
    assert item.deadline_raw == "thứ 6"
    assert item.source_refs == [ambiguous.source_ref]


def test_general_review_without_assignment_does_not_require_an_action_item():
    review = evidence(
        "10000000-0000-4000-8000-000000000021",
        "Cuối cùng nhóm sẽ kiểm tra tiến độ trong cuộc họp tiếp theo.",
        28700,
        33400,
    )
    result = validate_action({"action_items": []}, [review])
    assert result.action_items == []


def test_relative_weekday_cannot_be_resolved_to_an_absolute_date():
    task = evidence(
        "10000000-0000-4000-8000-000000000009",
        "Mình chịu trách nhiệm thiết kế cơ sở dữ liệu và phải hoàn thành thứ 6.",
        1000,
        4000,
    )
    expect_evidence_error(
        action("Thiết kế cơ sở dữ liệu", None, "2026-11-06", "thứ 6", [task.source_ref]),
        [task],
        "unsupported_absolute_deadline",
    )


def test_incomplete_asr_date_does_not_support_iso_deadline():
    task = evidence(
        "10000000-0000-4000-8000-000000000010",
        "Hùng phụ trách kiểm thử và báo cáo vào ngày 12.",
        1000,
        4000,
    )
    expect_evidence_error(
        action("Kiểm thử", "Hùng", "2026-11-12", "ngày 12", [task.source_ref]),
        [task],
        "unsupported_absolute_deadline",
    )


def test_explicit_calendar_date_without_deadline_language_is_not_assigned_as_due_date():
    task = evidence(
        "10000000-0000-4000-8000-000000000019",
        "Lan sẽ phải phát triển giao diện đăng nhập. Cuộc họp diễn ra ngày 10 tháng 11 năm 2026.",
        1000,
        4500,
    )
    expect_evidence_error(
        action("Phát triển giao diện đăng nhập", "Lan", "2026-11-10", None, [task.source_ref]),
        [task],
        "unsupported_absolute_deadline",
    )


def test_date_from_nonadjacent_segment_cannot_be_attached_to_task():
    task = evidence(
        "10000000-0000-4000-8000-000000000011",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        1000,
        2200,
    )
    other_task = evidence(
        "10000000-0000-4000-8000-000000000012",
        "Hùng phụ trách kiểm thử video.",
        3000,
        4500,
    )
    date_only = evidence(
        "10000000-0000-4000-8000-000000000013",
        "Hạn hoàn thành là ngày 10 tháng 11 năm 2026.",
        5000,
        6200,
    )
    expect_evidence_error(
        action(
            "Phát triển giao diện đăng nhập",
            "Lan",
            "2026-11-10",
            None,
            [task.source_ref, other_task.source_ref, date_only.source_ref],
        ),
        [task, other_task, date_only],
        "unsupported_absolute_deadline",
    )


def test_adjacent_second_assignment_keeps_its_own_deadline():
    lan_task = evidence(
        "10000000-0000-4000-8000-000000000017",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        1000,
        2200,
    )
    hung_task = evidence(
        "10000000-0000-4000-8000-000000000018",
        "Hùng phụ trách kiểm thử video và báo cáo kết quả ngày 12 tháng 11 năm 2026.",
        2300,
        5000,
    )
    expect_evidence_error(
        action(
            "Phát triển giao diện đăng nhập",
            "Lan",
            "2026-11-12",
            None,
            [lan_task.source_ref, hung_task.source_ref],
        ),
        [lan_task, hung_task],
        "unsupported_absolute_deadline",
    )


def test_confirmed_technology_decision_passes_but_negated_decision_fails():
    positive = evidence(
        "10000000-0000-4000-8000-000000000014",
        "Cả nhóm thống nhất sử dụng PostgreSQL làm cơ sở dữ liệu và React để phát triển giao diện.",
        1000,
        4000,
    )
    confirmed = {
        "decisions": [{
            "text": "Thống nhất sử dụng PostgreSQL và React.",
            "source_refs": [positive.source_ref],
        }],
        "proposals": [],
        "open_issues": [],
    }
    result = validate_summary_output(
        json.dumps(confirmed, ensure_ascii=False),
        ClassificationExtraction,
        {positive.source_ref},
        [positive],
    )
    assert len(result.decisions) == 1

    negative = evidence(
        "10000000-0000-4000-8000-000000000015",
        "Nhóm chưa thống nhất sử dụng PostgreSQL.",
        1000,
        4000,
    )
    with pytest.raises(SummaryValidationError) as error:
        validate_summary_output(
            json.dumps(confirmed, ensure_ascii=False).replace(positive.source_ref, negative.source_ref),
            ClassificationExtraction,
            {negative.source_ref},
            [negative],
        )
    assert error.value.code == SummaryErrorCode.EVIDENCE_CONSISTENCY_ERROR
    assert error.value.validation_diagnostics[0]["type"] == "unconfirmed_decision"


def test_future_intent_to_agree_is_not_a_confirmed_decision():
    intent = evidence(
        "10000000-0000-4000-8000-000000000047",
        "Hôm nay nhóm họp để thống nhất sử dụng PostgreSQL.",
        1000,
        3000,
    )
    payload = {
        "decisions": [{
            "text": "Nhóm thống nhất sử dụng PostgreSQL.",
            "source_refs": [intent.source_ref],
        }],
        "proposals": [],
        "open_issues": [],
    }

    with pytest.raises(SummaryValidationError) as error:
        validate_summary_output(
            json.dumps(payload, ensure_ascii=False),
            ClassificationExtraction,
            {intent.source_ref},
            [intent],
        )
    assert error.value.validation_diagnostics[0]["type"] == "unconfirmed_decision"


def test_corrupted_asr_confirmation_word_does_not_create_a_decision():
    corrupted = evidence(
        "10000000-0000-4000-8000-000000000016",
        "Cả nhóm thỏng nhân sử dụng PostgreSQL làm cơ sở dữ liệu.",
        1000,
        4000,
    )
    decisions = {
        "decisions": [{"text": "Nhóm đã chọn PostgreSQL.", "source_refs": [corrupted.source_ref]}],
        "proposals": [],
        "open_issues": [],
    }
    with pytest.raises(SummaryValidationError) as error:
        validate_summary_output(
            json.dumps(decisions, ensure_ascii=False),
            ClassificationExtraction,
            {corrupted.source_ref},
            [corrupted],
        )
    assert error.value.validation_diagnostics[0]["type"] == "unconfirmed_decision"


def test_normalization_restores_only_explicit_named_assignee():
    task = evidence(
        "10000000-0000-4000-8000-000000000041",
        "Minh phụ trách thiết kế cơ sở dữ liệu.",
        1000,
        3000,
    )
    result = normalize_and_validate({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Minh phụ trách thiết kế cơ sở dữ liệu.",
        "executive_summary_refs": [task.source_ref],
        "key_points": [],
        "decisions": [],
        "action_items": [{
            "title": "Thiết kế cơ sở dữ liệu",
            "assignee": "Lan",
            "deadline": None,
            "deadline_raw": None,
            "source_refs": [task.source_ref],
        }],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }, [task])

    assert result.action_items[0].assignee == "Minh"


def test_normalization_keeps_relative_deadline_raw_and_clears_hallucinated_iso():
    task = evidence(
        "10000000-0000-4000-8000-000000000042",
        "Minh phụ trách thiết kế cơ sở dữ liệu.",
        1000,
        2200,
    )
    deadline = evidence(
        "10000000-0000-4000-8000-000000000043",
        "Hạn hoàn thành là trước thứ Sáu.",
        2300,
        3400,
    )
    result = normalize_and_validate({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Minh thiết kế cơ sở dữ liệu.",
        "executive_summary_refs": [task.source_ref],
        "key_points": [], "decisions": [],
        "action_items": [{
            "title": "Thiết kế cơ sở dữ liệu",
            "assignee": "Minh",
            "deadline": "2026-11-06",
            "deadline_raw": None,
            "source_refs": [task.source_ref],
        }],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }, [task, deadline])

    item = result.action_items[0]
    assert item.deadline is None
    assert item.deadline_raw == "trước thứ Sáu"
    assert item.source_refs == [task.source_ref, deadline.source_ref]


@pytest.mark.parametrize(
    ("text", "expected_raw", "expected_iso"),
    [
        ("Hùng phụ trách kiểm thử upload video và phải báo cáo ngày 12 tháng 11 năm 2026.",
         "ngày 12 tháng 11 năm 2026", "2026-11-12"),
        ("Hùng phụ trách kiểm thử upload video và báo cáo kết quả ngày 12.",
         "ngày 12", None),
    ],
)
def test_normalization_parses_only_explicit_absolute_deadline(text, expected_raw, expected_iso):
    task = evidence(
        "10000000-0000-4000-8000-000000000044",
        text,
        1000,
        5000,
    )
    result = normalize_and_validate({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Hùng kiểm thử upload video.",
        "executive_summary_refs": [task.source_ref],
        "key_points": [], "decisions": [],
        "action_items": [{
            "title": "Kiểm thử upload video",
            "assignee": "Hùng",
            "deadline": "2026-11-12",
            "deadline_raw": None,
            "source_refs": [task.source_ref],
        }],
        "open_issues": [], "next_steps": [], "conflicts": [],
    }, [task])

    item = result.action_items[0]
    assert item.deadline_raw == expected_raw
    assert item.deadline == expected_iso


def test_normalization_adds_decision_only_for_completed_agreement():
    intent = evidence(
        "10000000-0000-4000-8000-000000000045",
        "Hôm nay nhóm họp để thống nhất công việc của dự án SmartRec.",
        1000,
        3000,
    )
    agreement = evidence(
        "10000000-0000-4000-8000-000000000046",
        "Nhóm đã thống nhất sử dụng PostgreSQL làm cơ sở dữ liệu và React để phát triển giao diện.",
        3100,
        6000,
    )
    result = normalize_summary_from_evidence({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Nhóm bàn về SmartRec.",
        "executive_summary_refs": [intent.source_ref],
        "key_points": [],
        "decisions": [{"text": "Nhóm đồng ý về công nghệ.", "source_refs": [intent.source_ref]}],
        "action_items": [], "open_issues": [], "next_steps": [], "conflicts": [],
    }, [intent, agreement])

    assert result["decisions"] == [{
        "text": agreement.text,
        "source_refs": [agreement.source_ref],
    }]


def test_relative_weekday_without_deadline_context_is_not_treated_as_a_deadline():
    evidence_text = "Cuộc họp tiếp theo diễn ra vào thứ Sáu."
    from app.services.meeting_summary_evidence import _has_relative_deadline

    assert not _has_relative_deadline(evidence_text)


def test_assigned_task_cannot_be_reclassified_as_a_proposal():
    task = evidence(
        "10000000-0000-4000-8000-000000000029",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        1000,
        2200,
    )
    summary = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": None,
        "executive_summary_refs": [],
        "key_points": [{
            "text": "Lan đề xuất phát triển giao diện đăng nhập.",
            "kind": "PROPOSAL",
            "source_refs": [task.source_ref],
        }],
        "decisions": [],
        "action_items": [{
            "title": "Phát triển giao diện đăng nhập",
            "assignee": "Lan",
            "deadline": None,
            "deadline_raw": None,
            "source_refs": [task.source_ref],
        }],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }

    with pytest.raises(SummaryValidationError) as error:
        validate_summary_output(
            json.dumps(summary, ensure_ascii=False),
            MeetingSummary,
            {task.source_ref},
            [task],
        )
    assert error.value.validation_diagnostics[0]["type"] == "unsupported_proposal"


def test_assigned_task_claim_cannot_be_repeated_in_key_points():
    task = evidence(
        "10000000-0000-4000-8000-000000000032",
        "Lan sẽ phải phát triển giao diện đăng nhập.",
        1000,
        2200,
    )
    summary = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": None,
        "executive_summary_refs": [],
        "key_points": [{
            "text": "Lan sẽ phải phát triển giao diện đăng nhập.",
            "kind": "DISCUSSION",
            "source_refs": [task.source_ref],
        }],
        "decisions": [],
        "action_items": [{
            "title": "Phát triển giao diện đăng nhập",
            "assignee": "Lan",
            "deadline": None,
            "deadline_raw": None,
            "source_refs": [task.source_ref],
        }],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }

    with pytest.raises(SummaryValidationError) as error:
        validate_summary_output(
            json.dumps(summary, ensure_ascii=False),
            MeetingSummary,
            {task.source_ref},
            [task],
        )

    assert "assigned_task_misclassified" in {
        item["type"] for item in error.value.validation_diagnostics
    }


def test_explicit_proposal_cue_supports_proposal_classification():
    proposal = evidence(
        "10000000-0000-4000-8000-000000000030",
        "Nhóm đề xuất sử dụng React cho giao diện.",
        1000,
        2200,
    )
    summary = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": None,
        "executive_summary_refs": [],
        "key_points": [{
            "text": "Đề xuất dùng React cho giao diện.",
            "kind": "PROPOSAL",
            "source_refs": [proposal.source_ref],
        }],
        "decisions": [],
        "action_items": [],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }

    result = validate_summary_output(
        json.dumps(summary, ensure_ascii=False),
        MeetingSummary,
        {proposal.source_ref},
        [proposal],
    )
    assert result.key_points[0].kind == "PROPOSAL"

