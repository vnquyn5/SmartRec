"""Unit tests for AI-owned Explainability Service."""

import pytest

from app.services.explainability_service import (
    build_action_item_explanations,
)


def test_build_action_item_explanations_valid():
    assessments = [{
        "actionIndex": 0,
        "sourceRefs": ["TRANSCRIPT:segment-001"],
        "resolvedSourceRefs": ["TRANSCRIPT:segment-001"],
        "fields": {
            "title": {
                "status": "SUPPORTED",
                "score": None,
                "diagnosticTypes": [],
            },
            "deadline": {
                "status": "CONFLICTED",
                "score": None,
                "diagnosticTypes": [
                    "inconsistent_action_deadline",
                ],
            },
        },
    }]

    result = build_action_item_explanations(assessments)

    assert result["schemaVersion"] == "smartrec.ai.explainability.v1"
    assert result["status"] == "AVAILABLE"
    assert result["calibrationStatus"] == "NOT_AVAILABLE"
    assert len(result["actionItems"]) == 1

    action = result["actionItems"][0]

    assert action["actionIndex"] == 0
    assert action["sourceRefs"] == ["TRANSCRIPT:segment-001"]
    assert action["fields"]["title"]["status"] == "SUPPORTED"
    assert action["fields"]["deadline"]["status"] == "CONFLICTED"
    assert all(
        field["score"] is None
        for field in action["fields"].values()
    )


def test_build_action_item_explanations_empty():
    result = build_action_item_explanations([])

    assert result["status"] == "UNKNOWN"
    assert result["actionItems"] == []
    assert result["calibrationStatus"] == "NOT_AVAILABLE"


@pytest.mark.parametrize(
    "invalid_assessment",
    [
        "not-a-list",
        [None],
        [{"actionIndex": 1, "sourceRefs": [], "fields": {}}],
        [{"actionIndex": 0, "sourceRefs": ["SRC"], "fields": {
            "title": {
                "status": "INVALID",
                "score": None,
                "diagnosticTypes": [],
            },
        }}],
        [{"actionIndex": 0, "sourceRefs": ["SRC"], "fields": {
            "title": {
                "status": "SUPPORTED",
                "score": 0.9,
                "diagnosticTypes": [],
            },
        }}],
        [{"actionIndex": 0, "sourceRefs": ["SRC"], "fields": {
            "title": {
                "status": "UNKNOWN",
                "score": None,
                "diagnosticTypes": "invalid",
            },
        }}],
    ],
)
def test_build_action_item_explanations_rejects_invalid(
    invalid_assessment,
):
    with pytest.raises(ValueError):
        build_action_item_explanations(invalid_assessment)


def test_explainability_resolved_source_references():
    from app.services.explainability_service import (
        build_action_item_explanations,
    )

    def assessment(refs, resolved):
        return [{
            "actionIndex": 0,
            "sourceRefs": refs,
            "resolvedSourceRefs": resolved,
            "fields": {
                "title": {
                    "status": "UNKNOWN",
                    "score": None,
                    "diagnosticTypes": [],
                },
            },
        }]

    valid = build_action_item_explanations(
        assessment(
            ["TRANSCRIPT:segment-001"],
            ["TRANSCRIPT:segment-001"],
        )
    )

    assert valid["actionItems"][0]["resolvedSourceRefs"] == [
        "TRANSCRIPT:segment-001"
    ]

    # A source that was not resolved must not be invented.
    unresolved = build_action_item_explanations(
        assessment(
            ["TRANSCRIPT:segment-001"],
            [],
        )
    )

    assert unresolved["actionItems"][0]["resolvedSourceRefs"] == []

    # A resolved reference must belong to the cited references.
    with pytest.raises(ValueError):
        build_action_item_explanations(
            assessment(
                ["TRANSCRIPT:segment-001"],
                ["TRANSCRIPT:segment-999"],
            )
        )

    # Missing provenance information must be rejected.
    missing = assessment(
        ["TRANSCRIPT:segment-001"],
        [],
    )
    del missing[0]["resolvedSourceRefs"]

    with pytest.raises(ValueError):
        build_action_item_explanations(missing)


def test_normalize_validate_and_explain_local_summary(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from app.services import explainability_service as service
    from app.services import meeting_summary_pipeline as pipeline

    summary = SimpleNamespace(action_items=[object()])

    assessments = [{
        "actionIndex": 0,
        "sourceRefs": ["TRANSCRIPT:segment-001"],
        "resolvedSourceRefs": ["TRANSCRIPT:segment-001"],
        "fields": {
            "title": {
                "status": "SUPPORTED",
                "score": None,
                "diagnosticTypes": [],
            },
            "assignee": {
                "status": "UNKNOWN",
                "score": None,
                "diagnosticTypes": [],
            },
        },
    }]

    mocked_pipeline = Mock(
        return_value=(summary, assessments)
    )

    monkeypatch.setattr(
        pipeline,
        "normalize_validate_and_assess_local_summary",
        mocked_pipeline,
    )

    evidence = [{
        "source_type": "TRANSCRIPT",
        "source_id": "segment-001",
        "text": "Nội dung cuộc họp",
    }]

    result_summary, explanations = (
        service.normalize_validate_and_explain_local_summary(
            raw_output='{"test": true}',
            allowed_source_refs=["S1"],
            evidence=evidence,
        )
    )

    assert result_summary is summary

    mocked_pipeline.assert_called_once_with(
        '{"test": true}',
        ["S1"],
        evidence,
    )

    assert explanations["schemaVersion"] == (
        "smartrec.ai.explainability.v1"
    )
    assert explanations["status"] == "AVAILABLE"
    assert explanations["calibrationStatus"] == "NOT_AVAILABLE"

    assert len(explanations["actionItems"]) == 1

    action = explanations["actionItems"][0]

    assert action["sourceRefs"] == [
        "TRANSCRIPT:segment-001"
    ]
    assert action["resolvedSourceRefs"] == [
        "TRANSCRIPT:segment-001"
    ]
    assert action["fields"]["title"]["status"] == "SUPPORTED"
    assert action["fields"]["assignee"]["status"] == "UNKNOWN"

    assert all(
        field["score"] is None
        for field in action["fields"].values()
    )


def test_explainability_real_summary_pipeline_without_mocks():
    import json
    from uuid import UUID

    from app.schemas.local_llm import ContextEvidence
    from app.schemas.meeting_summary import SCHEMA_VERSION
    from app.services.explainability_service import (
        normalize_validate_and_explain_local_summary,
    )

    source_id = UUID("10000000-0000-4000-8000-000000000041")

    source = ContextEvidence(
        source_type="TRANSCRIPT",
        source_id=source_id,
        speaker_id=None,
        start_time_ms=1000,
        end_time_ms=3000,
        text="Minh phụ trách thiết kế cơ sở dữ liệu.",
    )

    compact_summary = {
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Minh phụ trách thiết kế cơ sở dữ liệu.",
        "executive_summary_refs": ["S1"],
        "key_points": [],
        "decisions": [],
        "action_items": [{
            "title": "Thiết kế cơ sở dữ liệu",
            "assignee": "Minh",
            "deadline": None,
            "deadline_raw": None,
            "source_refs": ["S1"],
        }],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }

    summary, explanations = normalize_validate_and_explain_local_summary(
        raw_output=json.dumps(compact_summary, ensure_ascii=False),
        allowed_source_refs=["S1"],
        evidence=[source],
    )

    expected_ref = f"TRANSCRIPT:{source_id}"

    assert len(summary.action_items) == 1
    assert summary.action_items[0].assignee == "Minh"
    assert summary.action_items[0].source_refs == [expected_ref]

    assert explanations["schemaVersion"] == (
        "smartrec.ai.explainability.v1"
    )
    assert explanations["status"] == "AVAILABLE"
    assert explanations["calibrationStatus"] == "NOT_AVAILABLE"

    assert len(explanations["actionItems"]) == 1

    action = explanations["actionItems"][0]

    assert action["sourceRefs"] == [expected_ref]
    assert action["resolvedSourceRefs"] == [expected_ref]

    fields = action["fields"]

    assert fields["title"]["status"] == "SUPPORTED"
    assert fields["assignee"]["status"] == "SUPPORTED"
    assert fields["deadline"]["status"] == "UNKNOWN"
    assert fields["deadline_raw"]["status"] == "UNKNOWN"
    assert fields["source_refs"]["status"] == "SUPPORTED"

    assert all(field["score"] is None for field in fields.values())


def test_supported_evidence_requires_resolved_source():
    from app.services.explainability_service import (
        build_action_item_explanations,
    )

    def make_assessment(status, resolved_refs):
        return [{
            "actionIndex": 0,
            "sourceRefs": ["TRANSCRIPT:segment-001"],
            "resolvedSourceRefs": resolved_refs,
            "fields": {
                "title": {
                    "status": status,
                    "score": None,
                    "diagnosticTypes": [],
                },
            },
        }]

    # A positive evidence claim cannot lack resolved provenance.
    with pytest.raises(
        ValueError,
        match="SUPPORTED evidence requires resolved source references",
    ):
        build_action_item_explanations(
            make_assessment("SUPPORTED", [])
        )

    # A supported claim with resolved provenance is structurally valid.
    supported = build_action_item_explanations(
        make_assessment(
            "SUPPORTED",
            ["TRANSCRIPT:segment-001"],
        )
    )

    assert (
        supported["actionItems"][0]["fields"]["title"]["status"]
        == "SUPPORTED"
    )

    # Missing evidence may legitimately remain UNKNOWN.
    unknown = build_action_item_explanations(
        make_assessment("UNKNOWN", [])
    )

    assert (
        unknown["actionItems"][0]["fields"]["title"]["status"]
        == "UNKNOWN"
    )

    for result in (supported, unknown):
        assert all(
            field["score"] is None
            for field in result["actionItems"][0]["fields"].values()
        )


def test_explainability_artifact_persistence_and_integrity(
    tmp_path, monkeypatch
):
    import json
    from uuid import uuid4

    from app.services.artifact_provenance import read_verified_source
    from app.services.explainability_service import (
        normalize_validate_and_explain_local_summary,
        save_explainability_artifact,
    )

    root = tmp_path.resolve(strict=True)
    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(root))

    meeting_id = str(uuid4())
    job_id = str(uuid4())

    job_dir = root / job_id
    job_dir.mkdir()

    artifact_path = job_dir / "04_explainability.json"

    from uuid import UUID
    from app.schemas.local_llm import ContextEvidence
    from app.schemas.meeting_summary import SCHEMA_VERSION

    source_id = UUID("10000000-0000-4000-8000-000000000041")

    evidence = [ContextEvidence(
        source_type="TRANSCRIPT",
        source_id=source_id,
        speaker_id=None,
        start_time_ms=1000,
        end_time_ms=3000,
        text="Minh phụ trách thiết kế cơ sở dữ liệu.",
    )]

    raw_output = json.dumps({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Minh phụ trách thiết kế cơ sở dữ liệu.",
        "executive_summary_refs": ["S1"],
        "key_points": [],
        "decisions": [],
        "action_items": [{
            "title": "Thiết kế cơ sở dữ liệu",
            "assignee": "Minh",
            "deadline": None,
            "deadline_raw": None,
            "source_refs": ["S1"],
        }],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }, ensure_ascii=False)

    _, explanations = normalize_validate_and_explain_local_summary(
        raw_output=raw_output,
        allowed_source_refs=["S1"],
        evidence=evidence,
    )

    source = save_explainability_artifact(
        artifact_path,
        explanations,
        meeting_id,
        job_id,
        raw_output=raw_output,
        allowed_source_refs=["S1"],
        evidence=evidence,
    )

    assert artifact_path.is_file()

    verified = read_verified_source(
        root, source, meeting_id, job_id
    )

    assert json.loads(verified) == explanations
    assert source.meeting_id == meeting_id
    assert source.job_id == job_id
    assert len(source.sha256) == 64

    # A different job must not access this artifact.
    with pytest.raises(ValueError):
        read_verified_source(
            root, source, meeting_id, str(uuid4())
        )

    # A different meeting must not access this artifact.
    with pytest.raises(ValueError):
        read_verified_source(
            root, source, str(uuid4()), job_id
        )

    # Detect modifications after provenance capture.
    artifact_path.write_text(
        '{"tampered": true}',
        encoding="utf-8",
    )

    with pytest.raises(ValueError):
        read_verified_source(
            root, source, meeting_id, job_id
        )


def test_action_index_rejects_boolean_and_non_integer_values():
    from app.services.explainability_service import (
        build_action_item_explanations,
    )

    def make_assessment(index):
        return {
            "actionIndex": index,
            "sourceRefs": [],
            "resolvedSourceRefs": [],
            "fields": {},
        }

    for invalid_index in (False, True, 0.0, "0", None):
        with pytest.raises(ValueError, match="actionIndex mismatch"):
            build_action_item_explanations(
                [make_assessment(invalid_index)]
            )

    result = build_action_item_explanations(
        [make_assessment(0), make_assessment(1)]
    )

    assert [
        item["actionIndex"]
        for item in result["actionItems"]
    ] == [0, 1]


def test_persistence_rejects_forged_supported_evidence(
    tmp_path, monkeypatch
):
    import copy
    import json
    from uuid import UUID, uuid4

    from app.schemas.local_llm import ContextEvidence
    from app.schemas.meeting_summary import SCHEMA_VERSION
    from app.services.explainability_service import (
        normalize_validate_and_explain_local_summary,
        save_explainability_artifact,
    )

    root = tmp_path.resolve(strict=True)
    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(root))

    meeting_id = str(uuid4())
    job_id = str(uuid4())
    artifact_path = root / job_id / "04_explainability.json"

    evidence = [ContextEvidence(
        source_type="TRANSCRIPT",
        source_id=UUID("10000000-0000-4000-8000-000000000041"),
        speaker_id=None,
        start_time_ms=1000,
        end_time_ms=3000,
        text="Minh phụ trách thiết kế cơ sở dữ liệu.",
    )]

    raw_output = json.dumps({
        "schema_version": SCHEMA_VERSION,
        "executive_summary": "Minh phụ trách thiết kế cơ sở dữ liệu.",
        "executive_summary_refs": ["S1"],
        "key_points": [],
        "decisions": [],
        "action_items": [{
            "title": "Thiết kế cơ sở dữ liệu",
            "assignee": "Minh",
            "deadline": None,
            "deadline_raw": None,
            "source_refs": ["S1"],
        }],
        "open_issues": [],
        "next_steps": [],
        "conflicts": [],
    }, ensure_ascii=False)

    _, verified = normalize_validate_and_explain_local_summary(
        raw_output=raw_output,
        allowed_source_refs=["S1"],
        evidence=evidence,
    )

    assert verified["actionItems"][0]["fields"]["deadline"]["status"] == (
        "UNKNOWN"
    )
    assert verified["actionItems"][0]["resolvedSourceRefs"]

    forged = copy.deepcopy(verified)
    forged["actionItems"][0]["fields"]["deadline"]["status"] = (
        "SUPPORTED"
    )

    # The forged claim has valid resolved references but lacks
    # actual deadline evidence.
    with pytest.raises(
        ValueError,
        match="does not match verified evidence",
    ):
        save_explainability_artifact(
            artifact_path,
            forged,
            meeting_id,
            job_id,
            raw_output=raw_output,
            allowed_source_refs=["S1"],
            evidence=evidence,
        )

    assert not artifact_path.exists()

    # The unmodified, verified metadata must still be accepted.
    source = save_explainability_artifact(
        artifact_path,
        verified,
        meeting_id,
        job_id,
        raw_output=raw_output,
        allowed_source_refs=["S1"],
        evidence=evidence,
    )

    assert artifact_path.is_file()
    assert source.job_id == job_id
