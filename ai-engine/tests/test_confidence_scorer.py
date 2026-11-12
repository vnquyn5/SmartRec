
"""Unit tests for confidence-related ASR signal extraction."""

from types import SimpleNamespace

import pytest

from app.services.confidence_scorer import (
    extract_transcript_signals,
    transcript_segment_fingerprint,
    build_transcript_confidence_sidecar,
    verify_transcript_confidence_sidecar,
)


def extract(segment, adapter="faster-whisper"):
    return extract_transcript_signals(
        segment,
        adapter=adapter,
        model_identifier="faster-whisper-small",
        model_version="1.1.1",
        source_segment_id="segment-001",
    )


def test_extract_valid_faster_whisper_signals():
    segment = SimpleNamespace(
        text="Hoàn thành báo cáo",
        start=1.0,
        end=2.0,
        avg_logprob=-0.31,
        no_speech_prob=0.02,
        compression_ratio=1.15,
        words=[
            SimpleNamespace(
                word="Hoàn thành",
                start=1.0,
                end=1.5,
                probability=0.91,
            )
        ],
    )

    result = extract(segment)

    assert result["score"] is None
    assert result["status"] == "UNSCORED"
    assert result["calibrationStatus"] == "NOT_AVAILABLE"
    assert len(result["provenance"]["rawSignals"]) == 3
    assert result["provenance"]["words"][0]["probability"] == 0.91


def test_missing_signals_returns_unknown():
    segment = SimpleNamespace(text="Xin chào", start=0.0, end=1.0)

    result = extract(segment, adapter="whisper.cpp")

    assert result["score"] is None
    assert result["status"] == "UNKNOWN"
    assert result["provenance"]["rawSignals"] == []
    assert result["provenance"]["words"] == []


@pytest.mark.parametrize("invalid_value", [
    float("nan"),
    float("inf"),
    float("-inf"),
    True,
    "0.9",
])
def test_invalid_segment_signals_are_ignored(invalid_value):
    segment = SimpleNamespace(
        avg_logprob=invalid_value,
        no_speech_prob=invalid_value,
        compression_ratio=invalid_value,
        words=[],
    )

    result = extract(segment)

    assert result["score"] is None
    assert result["status"] == "UNKNOWN"
    assert result["provenance"]["rawSignals"] == []


@pytest.mark.parametrize("invalid_probability", [
    -0.1,
    1.1,
    float("nan"),
    None,
    "0.8",
])
def test_invalid_word_probabilities_are_ignored(invalid_probability):
    segment = SimpleNamespace(
        words=[
            SimpleNamespace(
                word="Test",
                start=0.0,
                end=0.5,
                probability=invalid_probability,
            )
        ]
    )

    result = extract(segment)

    assert result["status"] == "UNKNOWN"
    assert result["provenance"]["words"] == []


def test_extraction_does_not_mutate_source_segment():
    segment = SimpleNamespace(
        text="Giữ nguyên nội dung",
        start=1.0,
        end=3.0,
        avg_logprob=-0.2,
        words=[],
    )

    before = vars(segment).copy()

    extract(segment)

    assert vars(segment) == before


def test_extraction_is_deterministic():
    segment = SimpleNamespace(
        avg_logprob=-0.25,
        words=[],
    )

    first = extract(segment)
    second = extract(segment)

    assert first == second


@pytest.mark.parametrize("adapter,source_id", [
    ("", "segment-001"),
    ("faster-whisper", ""),
])
def test_required_provenance_is_validated(adapter, source_id):
    with pytest.raises(ValueError):
        extract_transcript_signals(
            SimpleNamespace(),
            adapter=adapter,
            model_identifier=None,
            model_version=None,
            source_segment_id=source_id,
        )


@pytest.mark.parametrize(
    "field,invalid_value",
    [
        ("avg_logprob", 0.2),
        ("no_speech_prob", -0.1),
        ("no_speech_prob", 1.5),
        ("compression_ratio", 0.0),
        ("compression_ratio", -2.0),
    ],
)
def test_out_of_range_segment_signals_are_ignored(field, invalid_value):
    segment = SimpleNamespace(
        avg_logprob=None,
        no_speech_prob=None,
        compression_ratio=None,
        words=[],
    )
    setattr(segment, field, invalid_value)

    result = extract(segment)

    assert result["score"] is None
    assert result["status"] == "UNKNOWN"
    assert result["provenance"]["rawSignals"] == []


@pytest.mark.parametrize(
    "start,end",
    [
        (3.0, 1.0),
        (-1.0, 1.0),
        (1.0, 1.0),
        (float("nan"), 2.0),
        (1.0, float("inf")),
        (None, 2.0),
    ],
)
def test_invalid_word_timestamps_are_ignored(start, end):
    segment = SimpleNamespace(
        words=[
            SimpleNamespace(
                word="Test",
                start=start,
                end=end,
                probability=0.9,
            )
        ]
    )

    result = extract(segment)

    assert result["score"] is None
    assert result["status"] == "UNKNOWN"
    assert result["provenance"]["words"] == []


def test_transcript_fingerprint_is_deterministic():
    segment = {
        "text": "Hoàn thành báo cáo",
        "startTimeMs": 1000,
        "endTimeMs": 2000,
        "speakerLabel": "SPEAKER_00",
    }

    first = transcript_segment_fingerprint(segment)
    second = transcript_segment_fingerprint(segment)

    assert first == second
    assert len(first) == 64


def test_transcript_fingerprint_detects_content_changes():
    original = {
        "text": "Hoàn thành báo cáo",
        "startTimeMs": 1000,
        "endTimeMs": 2000,
        "speakerLabel": "SPEAKER_00",
    }

    modified = {
        **original,
        "text": "Hoàn thành tài liệu",
    }

    assert (
        transcript_segment_fingerprint(original)
        != transcript_segment_fingerprint(modified)
    )


def test_transcript_fingerprint_detects_timestamp_changes():
    original = {
        "text": "Nội dung cuộc họp",
        "startTimeMs": 1000,
        "endTimeMs": 2000,
    }

    modified = {
        **original,
        "endTimeMs": 2500,
    }

    assert (
        transcript_segment_fingerprint(original)
        != transcript_segment_fingerprint(modified)
    )


def test_build_confidence_sidecar_preserves_metadata():
    segment = {
        "text": "Hoàn thành báo cáo",
        "startTimeMs": 1000,
        "endTimeMs": 2000,
        "speakerLabel": "SPEAKER_00",
    }

    metadata = {
        "score": None,
        "status": "UNSCORED",
        "calibrationStatus": "NOT_AVAILABLE",
    }

    sidecar = build_transcript_confidence_sidecar(
        meeting_id="meeting-001",
        job_id="job-001",
        transcript_segments=[segment],
        confidence_metadata=[metadata],
    )

    assert sidecar["schemaVersion"] == "smartrec.ai.stt-confidence.v1"
    assert sidecar["meetingId"] == "meeting-001"
    assert sidecar["processingJobId"] == "job-001"
    assert len(sidecar["entries"]) == 1

    entry = sidecar["entries"][0]

    assert entry["transcriptIndex"] == 0
    assert entry["transcriptFingerprint"] == (
        transcript_segment_fingerprint(segment)
    )
    assert entry["metadata"] == metadata


def test_confidence_sidecar_rejects_mismatched_counts():
    with pytest.raises(ValueError):
        build_transcript_confidence_sidecar(
            meeting_id="meeting-001",
            job_id="job-001",
            transcript_segments=[
                {
                    "text": "Test",
                    "startTimeMs": 0,
                    "endTimeMs": 1000,
                }
            ],
            confidence_metadata=[],
        )


def test_confidence_sidecar_rejects_uncalibrated_numeric_score():
    with pytest.raises(ValueError):
        build_transcript_confidence_sidecar(
            meeting_id="meeting-001",
            job_id="job-001",
            transcript_segments=[
                {
                    "text": "Test",
                    "startTimeMs": 0,
                    "endTimeMs": 1000,
                }
            ],
            confidence_metadata=[
                {
                    "score": 0.95,
                    "status": "UNSCORED",
                }
            ],
        )


def test_verify_confidence_sidecar_accepts_matching_transcript():
    segment = {
        "text": "Hoàn thành báo cáo",
        "startTimeMs": 1000,
        "endTimeMs": 2000,
        "speakerLabel": "SPEAKER_00",
    }
    metadata = {"score": None, "status": "UNSCORED"}

    sidecar = build_transcript_confidence_sidecar(
        meeting_id="meeting-001",
        job_id="job-001",
        transcript_segments=[segment],
        confidence_metadata=[metadata],
    )

    verified = verify_transcript_confidence_sidecar(
        sidecar=sidecar,
        meeting_id="meeting-001",
        job_id="job-001",
        transcript_segments=[segment],
    )

    assert verified == [metadata]


@pytest.mark.parametrize(
    "field,value",
    [
        ("schemaVersion", "invalid-schema"),
        ("meetingId", "another-meeting"),
        ("processingJobId", "another-job"),
        ("scorerVersion", "unknown-version"),
    ],
)
def test_verify_confidence_sidecar_rejects_invalid_identity(field, value):
    segment = {"text": "Test", "startTimeMs": 0, "endTimeMs": 1000}
    sidecar = build_transcript_confidence_sidecar(
        meeting_id="meeting-001",
        job_id="job-001",
        transcript_segments=[segment],
        confidence_metadata=[{"score": None}],
    )

    sidecar[field] = value

    with pytest.raises(ValueError):
        verify_transcript_confidence_sidecar(
            sidecar=sidecar,
            meeting_id="meeting-001",
            job_id="job-001",
            transcript_segments=[segment],
        )


def test_verify_confidence_sidecar_rejects_modified_transcript():
    segment = {"text": "Nội dung gốc", "startTimeMs": 0, "endTimeMs": 1000}

    sidecar = build_transcript_confidence_sidecar(
        meeting_id="meeting-001",
        job_id="job-001",
        transcript_segments=[segment],
        confidence_metadata=[{"score": None}],
    )

    modified_segment = {**segment, "text": "Nội dung đã sửa"}

    with pytest.raises(ValueError, match="fingerprint"):
        verify_transcript_confidence_sidecar(
            sidecar=sidecar,
            meeting_id="meeting-001",
            job_id="job-001",
            transcript_segments=[modified_segment],
        )


def test_verify_confidence_sidecar_rejects_wrong_index():
    segment = {"text": "Test", "startTimeMs": 0, "endTimeMs": 1000}

    sidecar = build_transcript_confidence_sidecar(
        meeting_id="meeting-001",
        job_id="job-001",
        transcript_segments=[segment],
        confidence_metadata=[{"score": None}],
    )

    sidecar["entries"][0]["transcriptIndex"] = 10

    with pytest.raises(ValueError, match="index"):
        verify_transcript_confidence_sidecar(
            sidecar=sidecar,
            meeting_id="meeting-001",
            job_id="job-001",
            transcript_segments=[segment],
        )


def test_verify_confidence_sidecar_rejects_numeric_confidence():
    segment = {"text": "Test", "startTimeMs": 0, "endTimeMs": 1000}

    sidecar = build_transcript_confidence_sidecar(
        meeting_id="meeting-001",
        job_id="job-001",
        transcript_segments=[segment],
        confidence_metadata=[{"score": None}],
    )

    sidecar["entries"][0]["metadata"]["score"] = 0.95

    with pytest.raises(ValueError, match="numeric confidence"):
        verify_transcript_confidence_sidecar(
            sidecar=sidecar,
            meeting_id="meeting-001",
            job_id="job-001",
            transcript_segments=[segment],
        )


def test_verify_confidence_sidecar_rejects_segment_count_mismatch():
    segment = {"text": "Test", "startTimeMs": 0, "endTimeMs": 1000}

    sidecar = build_transcript_confidence_sidecar(
        meeting_id="meeting-001",
        job_id="job-001",
        transcript_segments=[segment],
        confidence_metadata=[{"score": None}],
    )

    with pytest.raises(ValueError, match="count mismatch"):
        verify_transcript_confidence_sidecar(
            sidecar=sidecar,
            meeting_id="meeting-001",
            job_id="job-001",
            transcript_segments=[],
        )


def test_action_evidence_diagnostic_classification():
    from app.services.confidence_scorer import (
        classify_action_evidence_diagnostics,
    )

    cases = [
        (
            [{"loc": ["action_items", 0, "deadline"],
              "type": "inconsistent_action_deadline"}],
            "deadline",
            "CONFLICTED",
        ),
        (
            [{"loc": ["action_items", 0, "assignee"],
              "type": "unsupported_assignee"}],
            "assignee",
            "UNSUPPORTED",
        ),
        (
            [{"loc": ["action_items", 0, "source_refs"],
              "type": "missing_deadline_source_ref"}],
            "source_refs",
            "UNSUPPORTED",
        ),
        (
            [],
            "title",
            "UNKNOWN",
        ),
    ]

    for diagnostics, field_name, expected_status in cases:
        result = classify_action_evidence_diagnostics(
            diagnostics,
            action_index=0,
            field_name=field_name,
        )

        assert result["status"] == expected_status
        assert result["score"] is None

    # An issue belonging to another Action Item must not leak.
    unrelated = [{
        "loc": ["action_items", 1, "title"],
        "type": "unsupported_action_title",
    }]

    result = classify_action_evidence_diagnostics(
        unrelated,
        action_index=0,
        field_name="title",
    )

    assert result["status"] == "UNKNOWN"
    assert result["diagnosticTypes"] == []

    # A conflicting issue takes priority over an unsupported issue.
    mixed = [
        {
            "loc": ["action_items", 0, "deadline"],
            "type": "unsupported_absolute_deadline",
        },
        {
            "loc": ["action_items", 0, "deadline"],
            "type": "inconsistent_action_deadline",
        },
    ]

    result = classify_action_evidence_diagnostics(
        mixed,
        action_index=0,
        field_name="deadline",
    )

    assert result["status"] == "CONFLICTED"
    assert result["score"] is None


def test_assess_action_item_evidence_field_statuses():
    from app.services.confidence_scorer import (
        assess_action_item_evidence,
    )

    source = {
        "source_type": "TRANSCRIPT",
        "source_id": "segment-001",
        "text": "An hoàn thành báo cáo trước ngày 2026-11-20",
    }

    summary = {
        "action_items": [{
            "title": "Hoàn thành báo cáo",
            "assignee": "An",
            "deadline": "2026-11-21",
            "deadline_raw": None,
            "source_refs": ["TRANSCRIPT:segment-001"],
        }],
    }

    diagnostics = [
        {
            "loc": ["action_items", 0, "deadline"],
            "type": "inconsistent_action_deadline",
        },
        {
            "loc": ["action_items", 0, "assignee"],
            "type": "unsupported_assignee",
        },
    ]

    result = assess_action_item_evidence(
        summary,
        [source],
        diagnostics,
    )

    assert len(result) == 1
    fields = result[0]["fields"]

    assert fields["title"]["status"] == "SUPPORTED"
    assert fields["source_refs"]["status"] == "SUPPORTED"
    assert fields["assignee"]["status"] == "UNSUPPORTED"
    assert fields["deadline"]["status"] == "CONFLICTED"
    assert fields["deadline_raw"]["status"] == "UNKNOWN"

    assert all(
        field["score"] is None
        for field in fields.values()
    )

    # A missing source reference must never establish support.
    missing_summary = {
        "action_items": [{
            **summary["action_items"][0],
            "source_refs": ["TRANSCRIPT:missing-segment"],
        }],
    }

    missing = assess_action_item_evidence(
        missing_summary,
        [source],
        [],
    )

    assert missing[0]["fields"]["title"]["status"] == "UNKNOWN"
    assert missing[0]["fields"]["source_refs"]["status"] == "UNKNOWN"

    # An explicit unsupported diagnostic takes priority over
    # otherwise matching source text.
    unsupported = assess_action_item_evidence(
        summary,
        [source],
        [{
            "loc": ["action_items", 0, "title"],
            "type": "unsupported_action_title",
        }],
    )

    assert unsupported[0]["fields"]["title"]["status"] == "UNSUPPORTED"


def test_assignee_evidence_positive_and_negative_cases():
    from app.services.confidence_scorer import (
        assess_action_item_evidence,
    )

    summary = {
        "action_items": [{
            "title": "Hoàn thành báo cáo",
            "assignee": "An",
            "deadline": None,
            "deadline_raw": None,
            "source_refs": ["TRANSCRIPT:segment-001"],
        }],
    }

    assigned_source = {
        "source_type": "TRANSCRIPT",
        "source_id": "segment-001",
        "text": "An được giao nhiệm vụ hoàn thành báo cáo.",
    }

    supported = assess_action_item_evidence(
        summary,
        [assigned_source],
        [],
    )

    assert supported[0]["fields"]["assignee"]["status"] == "SUPPORTED"
    assert supported[0]["fields"]["assignee"]["score"] is None

    # Mentioning a name without assigning a task is insufficient.
    unassigned_source = {
        **assigned_source,
        "text": "An đã xem báo cáo.",
    }

    unknown = assess_action_item_evidence(
        summary,
        [unassigned_source],
        [],
    )

    assert unknown[0]["fields"]["assignee"]["status"] == "UNKNOWN"

    # Validator diagnostics must take precedence.
    unsupported = assess_action_item_evidence(
        summary,
        [assigned_source],
        [{
            "loc": ["action_items", 0, "assignee"],
            "type": "unsupported_assignee",
        }],
    )

    assert unsupported[0]["fields"]["assignee"]["status"] == "UNSUPPORTED"

    for result in (supported, unknown, unsupported):
        assert result[0]["fields"]["assignee"]["score"] is None


def test_action_item_deadline_evidence_assessment():
    from app.services.confidence_scorer import (
        assess_action_item_evidence,
    )

    def assess(text, deadline, deadline_raw=None):
        summary = {
            "action_items": [{
                "title": "Hoàn thành báo cáo",
                "assignee": "An",
                "deadline": deadline,
                "deadline_raw": deadline_raw,
                "source_refs": ["TRANSCRIPT:segment-001"],
            }]
        }

        evidence = [{
            "source_type": "TRANSCRIPT",
            "source_id": "segment-001",
            "text": text,
        }]

        result = assess_action_item_evidence(
            summary, evidence, []
        )

        return result[0]["fields"]

    # Case 1: Explicit absolute deadline.
    absolute = assess(
        "An được giao nhiệm vụ hoàn thành báo cáo "
        "trước ngày 2026-11-20.",
        "2026-11-20",
    )

    assert absolute["deadline"]["status"] == "SUPPORTED"
    assert absolute["deadline"]["score"] is None

    # Case 2: Relative deadline must not become an
    # invented absolute calendar date.
    relative = assess(
        "An được giao nhiệm vụ hoàn thành báo cáo "
        "trước thứ Sáu tuần tới.",
        None,
        "thứ Sáu tuần tới",
    )

    assert relative["deadline_raw"]["status"] == "SUPPORTED"
    assert relative["deadline"]["status"] == "UNKNOWN"

    # Case 3: No deadline evidence.
    missing = assess(
        "An được giao nhiệm vụ hoàn thành báo cáo.",
        "2026-11-20",
    )

    assert missing["deadline"]["status"] == "UNKNOWN"

    for fields in (absolute, relative, missing):
        assert all(
            field["score"] is None
            for field in fields.values()
        )


def test_summary_pipeline_evidence_assessment_integration(monkeypatch):
    from unittest.mock import Mock

    from app.services import meeting_summary_pipeline as pipeline

    validated_summary = object()
    evidence = [{"source_type": "TRANSCRIPT", "source_id": "segment-001"}]
    diagnostics = (
        {
            "loc": ["action_items", 0, "title"],
            "type": "unsupported_action_title",
        },
    )
    expected_assessments = [{
        "actionIndex": 0,
        "fields": {
            "title": {
                "status": "UNSUPPORTED",
                "score": None,
            }
        },
    }]

    normalize = Mock(return_value=validated_summary)
    validate_evidence = Mock(return_value=diagnostics)
    assess = Mock(return_value=expected_assessments)

    monkeypatch.setattr(
        pipeline,
        "normalize_and_validate_local_summary",
        normalize,
    )

    from app.services import meeting_summary_evidence
    from app.services import confidence_scorer

    monkeypatch.setattr(
        meeting_summary_evidence,
        "evidence_consistency_issues",
        validate_evidence,
    )
    monkeypatch.setattr(
        confidence_scorer,
        "assess_action_item_evidence",
        assess,
    )

    summary, assessments = (
        pipeline.normalize_validate_and_assess_local_summary(
            raw_output='{"test": true}',
            allowed_source_refs=["S1"],
            evidence=evidence,
        )
    )

    assert summary is validated_summary
    assert assessments is expected_assessments

    normalize.assert_called_once_with(
        '{"test": true}',
        ["S1"],
        evidence,
    )
    validate_evidence.assert_called_once_with(
        validated_summary,
        evidence,
    )
    assess.assert_called_once_with(
        validated_summary,
        evidence,
        diagnostics,
    )

    assert assessments[0]["fields"]["title"]["score"] is None


def test_finite_number_rejects_oversized_integers():
    from app.services.confidence_scorer import _finite_number

    invalid_values = (
        10 ** 1000,
        -(10 ** 1000),
        float("inf"),
        float("-inf"),
        float("nan"),
        True,
        False,
    )

    for value in invalid_values:
        assert _finite_number(value) is None

    assert _finite_number(0) == 0.0
    assert _finite_number(0.75) == 0.75
    assert _finite_number(-0.5) == -0.5
