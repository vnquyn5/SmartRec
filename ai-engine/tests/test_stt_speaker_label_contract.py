from types import SimpleNamespace
from uuid import uuid4

from app.services.transcript_parser import build_transcript_payload


def test_speaker_label_payload_matches_backend_contract():
    segment = SimpleNamespace(
        start=1.25,
        end=2.5,
        text="Hoàn thiện API upload."
    )

    payload = build_transcript_payload(
        meeting_id=uuid4(),
        processing_job_id=uuid4(),
        segments=[segment],
        speaker_labels={0: "SPEAKER_00"},
    )

    body = payload.model_dump(mode="json", exclude_none=True)
    item = body["segments"][0]

    assert item["speakerLabel"] == "SPEAKER_00"
    assert "speakerId" not in item
    assert item["startTimeMs"] == 1250
    assert item["endTimeMs"] == 2500
    assert item["text"] == "Hoàn thiện API upload."


def test_legacy_speaker_uuid_remains_supported():
    speaker_id = uuid4()

    segment = SimpleNamespace(
        start=0.0,
        end=1.0,
        text="Bắt đầu cuộc họp."
    )

    payload = build_transcript_payload(
        meeting_id=uuid4(),
        processing_job_id=uuid4(),
        segments=[segment],
        speaker_ids={0: speaker_id},
    )

    body = payload.model_dump(mode="json", exclude_none=True)
    item = body["segments"][0]

    assert item["speakerId"] == str(speaker_id)
    assert "speakerLabel" not in item
