"""Unit tests for strict SmartRec LLM JSON validation."""

import json
from copy import deepcopy

import pytest

from app.schemas.meeting_summary import (
    SCHEMA_VERSION,
    NON_BLANK_PATTERN,
    ISO_DATE_PATTERN,
    ActionExtraction,
    ClassificationExtraction,
    MeetingSummary,
)
from app.services.meeting_summary_json import (
    SummaryErrorCode,
    SummaryValidationError,
    validate_summary_output,
)


ACTIONS = {
    "action_items": [
        {
            "title": "Kiểm thử đăng nhập",
            "assignee": "Nam",
            "deadline_raw": "trước thứ Sáu",
            "source_refs": ["SRC_001"],
        },
        {
            "title": "Hoàn thành API upload",
            "assignee": "Khoa",
            "deadline_raw": None,
            "source_refs": ["SRC_001"],
        },
    ]
}

CLASSIFICATION = {
    "decisions": [
        {
            "text": "Thống nhất sử dụng MinIO",
            "source_refs": ["SRC_003"],
        }
    ],
    "proposals": [
        {
            "text": "Đề xuất sử dụng Redis",
            "source_refs": ["SRC_002"],
        }
    ],
    "open_issues": [
        {
            "text": "Timeout upload chưa giải quyết",
            "source_refs": ["SRC_004"],
        }
    ],
}

EMPTY_SUMMARY = {
    "schema_version": SCHEMA_VERSION,
    "executive_summary": None,
    "executive_summary_refs": [],
    "key_points": [],
    "decisions": [],
    "action_items": [],
    "open_issues": [],
    "next_steps": [],
    "conflicts": [],
}


def to_json(value):
    return json.dumps(value, ensure_ascii=False)


def parse(raw, model=ActionExtraction, refs=None):
    if refs is None:
        refs = {"SRC_001"}

    return validate_summary_output(raw, model, refs)


def expect_error(raw, expected, model=ActionExtraction, refs=None):
    with pytest.raises(SummaryValidationError) as error:
        parse(raw, model, refs)

    assert error.value.code == expected


def test_valid_action_extraction():
    result = parse(to_json(ACTIONS))

    assert len(result.action_items) == 2
    assert result.action_items[0].assignee == "Nam"
    assert result.action_items[0].deadline_raw == "trước thứ Sáu"
    assert result.action_items[1].assignee == "Khoa"


def test_valid_classification():
    result = parse(
        to_json(CLASSIFICATION),
        ClassificationExtraction,
        {"SRC_002", "SRC_003", "SRC_004"},
    )

    assert len(result.decisions) == 1
    assert len(result.proposals) == 1
    assert len(result.open_issues) == 1


@pytest.mark.parametrize(
    ("payload", "model"),
    [
        ({"action_items": []}, ActionExtraction),
        (
            {"decisions": [], "proposals": [], "open_issues": []},
            ClassificationExtraction,
        ),
    ],
)
def test_empty_extractions_are_valid(payload, model):
    result = parse(to_json(payload), model, set())
    assert result is not None


def test_empty_meeting_summary_is_valid():
    result = parse(
        to_json(EMPTY_SUMMARY),
        MeetingSummary,
        set(),
    )
    assert result.executive_summary is None
    assert result.action_items == []


def test_meeting_summary_json_schema_covers_runtime_field_and_cross_field_rules():
    schema = MeetingSummary.model_json_schema()

    assert schema["properties"]["executive_summary"]["anyOf"][0]["pattern"] == NON_BLANK_PATTERN
    assert schema["properties"]["action_items"]["items"]["$ref"].endswith("/ActionItem")
    action_schema = schema["$defs"]["ActionItem"]["properties"]
    assert action_schema["deadline"]["anyOf"][0]["pattern"] == ISO_DATE_PATTERN
    assert action_schema["deadline_raw"]["anyOf"][0]["pattern"] == NON_BLANK_PATTERN
    assert schema["properties"]["executive_summary"]["anyOf"][0]["pattern"].startswith("^")
    assert "\\S" not in schema["properties"]["executive_summary"]["anyOf"][0]["pattern"]
    assert schema["allOf"][0]["anyOf"][0]["properties"]["executive_summary_refs"]["minItems"] == 1
    assert schema["allOf"][0]["anyOf"][1]["properties"]["executive_summary_refs"]["maxItems"] == 0


@pytest.mark.parametrize("deadline", ["2026-11-12T00:00:00Z", "2026-02-30", "11/12/2026"])
def test_deadline_requires_a_valid_iso_calendar_date(deadline):
    payload = deepcopy(EMPTY_SUMMARY)
    payload["action_items"] = [{
        "title": "Report test results",
        "assignee": "Hùng",
        "deadline": deadline,
        "deadline_raw": None,
        "source_refs": ["SRC_001"],
    }]
    expect_error(
        to_json(payload),
        SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
        model=MeetingSummary,
        refs={"SRC_001"},
    )


def test_validation_diagnostics_exclude_untrusted_extra_field_name():
    payload = deepcopy(EMPTY_SUMMARY)
    secret_field = "PRIVATE_MEETING_SENTINEL"
    payload[secret_field] = "confidential"

    with pytest.raises(SummaryValidationError) as error:
        parse(to_json(payload), MeetingSummary, set())

    assert error.value.code == SummaryErrorCode.SCHEMA_VALIDATION_ERROR
    assert error.value.validation_diagnostics == (
        {"loc": ["<unknown>"], "type": "extra_forbidden"},
    )
    assert secret_field not in str(error.value.validation_diagnostics)


def test_balanced_json_code_fence():
    raw = "```json\n" + to_json(ACTIONS) + "\n```"
    assert len(parse(raw).action_items) == 2


def test_nested_trailing_comma_repair():
    raw = """
    {
      "action_items": [
        {
          "title": "Kiểm thử đăng nhập",
          "assignee": "Nam",
          "deadline_raw": null,
          "source_refs": ["SRC_001",],
        },
      ],
    }
    """

    result = parse(raw)
    assert result.action_items[0].assignee == "Nam"


def test_preserve_string_content():
    payload = deepcopy(ACTIONS)

    original = (
        'Kiểm tra chuỗi ",}" và ",]", '
        'dấu nháy "test", đường dẫn C:\\logs'
    )

    payload["action_items"][0]["title"] = original

    result = parse(to_json(payload))

    assert result.action_items[0].title == original


@pytest.mark.parametrize(
    "raw",
    [
        '{"action_items":[],"action_items":[]}',
        '{"action_items":[{"title":"A","title":"B"}]}',
        '{"action_items":[],"action_items":[],}',
        '```json\n{"action_items":[],"action_items":[]}\n```',
    ],
)
def test_duplicate_json_keys_rejected(raw):
    expect_error(raw, SummaryErrorCode.JSON_PARSE_ERROR)


@pytest.mark.parametrize(
    "raw",
    [
        '{"action_items":[',
        '{"action_items":[]} Additional text',
        '```json\n{"action_items":[]}',
    ],
)
def test_malformed_json_rejected(raw):
    expect_error(raw, SummaryErrorCode.JSON_PARSE_ERROR)


@pytest.mark.parametrize(
    "mutation",
    [
        "extra_field",
        "missing_assignee",
        "wrong_type",
        "empty_references",
    ],
)
def test_invalid_action_schema_rejected(mutation):
    payload = deepcopy(ACTIONS)

    if mutation == "extra_field":
        payload["invented_field"] = "unexpected"

    elif mutation == "missing_assignee":
        del payload["action_items"][0]["assignee"]

    elif mutation == "wrong_type":
        payload["action_items"] = "not a list"

    elif mutation == "empty_references":
        payload["action_items"][0]["source_refs"] = []

    expect_error(
        to_json(payload),
        SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
    )


def test_unknown_action_citation_rejected():
    expect_error(
        to_json(ACTIONS),
        SummaryErrorCode.SOURCE_REFERENCE_ERROR,
        refs={"SRC_999"},
    )


def test_unknown_classification_citation_rejected():
    expect_error(
        to_json(CLASSIFICATION),
        SummaryErrorCode.SOURCE_REFERENCE_ERROR,
        model=ClassificationExtraction,
        refs={"SRC_002", "SRC_003"},
    )


@pytest.mark.parametrize("raw", ["", "   "])
def test_empty_generation_rejected(raw):
    expect_error(raw, SummaryErrorCode.GENERATION_ERROR)


def test_executive_summary_requires_references():
    payload = deepcopy(EMPTY_SUMMARY)
    payload["executive_summary"] = "Nhóm thống nhất sử dụng MinIO."

    expect_error(
        to_json(payload),
        SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
        model=MeetingSummary,
        refs={"SRC_003"},
    )


def test_null_summary_cannot_have_references():
    payload = deepcopy(EMPTY_SUMMARY)
    payload["executive_summary_refs"] = ["SRC_003"]

    expect_error(
        to_json(payload),
        SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
        model=MeetingSummary,
        refs={"SRC_003"},
    )


def test_valid_executive_summary_with_reference():
    payload = deepcopy(EMPTY_SUMMARY)
    payload["executive_summary"] = "Nhóm thống nhất sử dụng MinIO."
    payload["executive_summary_refs"] = ["SRC_003"]

    result = parse(
        to_json(payload),
        MeetingSummary,
        {"SRC_003"},
    )

    assert result.executive_summary_refs == ["SRC_003"]


def test_vietnamese_sprint_fixture_contract_and_evidence_grounding():
    ref = "TRANSCRIPT:33333333-3333-4333-8333-333333333333"
    fixture_result = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Nhóm thống nhất công nghệ cho Sprint 4 và phân công ba công việc.",
        "executive_summary_refs": [ref],
        "key_points": [
            {"text": "Cuộc họp thống nhất công việc Sprint 4 của dự án SmartRec.",
             "kind": "DISCUSSION", "source_refs": [ref]},
        ],
        "decisions": [
            {"text": "Sử dụng PostgreSQL làm cơ sở dữ liệu.", "source_refs": [ref]},
            {"text": "Sử dụng React để phát triển giao diện.", "source_refs": [ref]},
        ],
        "action_items": [
            {"title": "Thiết kế cơ sở dữ liệu", "assignee": "Minh", "deadline": None,
             "deadline_raw": "trước thứ Sáu", "source_refs": [ref]},
            {"title": "Phát triển giao diện đăng nhập", "assignee": "Lan",
             "deadline": "2026-11-10", "deadline_raw": None, "source_refs": [ref]},
            {"title": "Kiểm thử chức năng upload video và báo cáo kết quả", "assignee": "Hùng",
             "deadline": "2026-11-12", "deadline_raw": None, "source_refs": [ref]},
        ],
        "open_issues": [],
        "next_steps": [
            {"text": "Kiểm tra tiến độ trong cuộc họp tiếp theo.", "source_refs": [ref]},
        ],
        "conflicts": [],
    }

    result = parse(to_json(fixture_result), MeetingSummary, {ref})

    assert [item.assignee for item in result.action_items] == ["Minh", "Lan", "Hùng"]
    assert result.action_items[0].deadline is None
    assert result.action_items[0].deadline_raw == "trước thứ Sáu"
    assert [item.deadline for item in result.action_items[1:]] == ["2026-11-10", "2026-11-12"]
    assert [item.text for item in result.decisions] == [
        "Sử dụng PostgreSQL làm cơ sở dữ liệu.",
        "Sử dụng React để phát triển giao diện.",
    ]
    assert all(set(item.source_refs) == {ref} for item in result.action_items + result.decisions)
    assert len(result.action_items) == 3
