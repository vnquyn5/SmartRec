"""Unit tests cho Transcript JSON Parser."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.stt_schemas import TranscriptSegment
from app.services.transcript_parser import (
    seconds_to_ms,
    parse_whisper_segments,
    build_transcript_payload,
)


def make_segment(start, end, text, words=None):
    return SimpleNamespace(
        start=start,
        end=end,
        text=text,
        words=words,
    )


def make_word(start, end):
    return SimpleNamespace(start=start, end=end)


def test_seconds_to_ms():
    assert seconds_to_ms(1.2345) == 1235
    assert seconds_to_ms(0) == 0
    assert seconds_to_ms(49.877313) == 49877


@pytest.mark.parametrize("value", [-1, float("nan"), float("inf")])
def test_invalid_seconds(value):
    with pytest.raises(ValueError):
        seconds_to_ms(value)


def test_parse_word_timestamps():
    segment = make_segment(
        1.0,
        3.0,
        " Xin chào mọi người.",
        words=[
            make_word(1.234, 1.500),
            make_word(1.500, 2.750),
        ],
    )

    result = parse_whisper_segments([segment])

    assert len(result) == 1
    assert result[0].startTimeMs == 1234
    assert result[0].endTimeMs == 2750
    assert result[0].text == "Xin chào mọi người."
    assert result[0].speakerId is None


def test_fallback_to_segment_timestamps():
    segment = make_segment(2.1, 4.3, "Nội dung", words=[])

    result = parse_whisper_segments([segment])

    assert result[0].startTimeMs == 2100
    assert result[0].endTimeMs == 4300


def test_skip_empty_text():
    segments = [
        make_segment(0, 1, "  "),
        make_segment(1, 2, "Có nội dung"),
    ]

    result = parse_whisper_segments(segments)

    assert len(result) == 1
    assert result[0].text == "Có nội dung"


def test_invalid_timestamp_order():
    segment = make_segment(5, 2, "Sai timestamp")

    with pytest.raises(ValueError):
        parse_whisper_segments([segment])


def test_speaker_uuid_mapping():
    speaker_id = uuid4()
    segment = make_segment(0, 1, "Xin chào")

    result = parse_whisper_segments(
        [segment],
        speaker_ids={0: speaker_id},
    )

    assert result[0].speakerId == speaker_id


def test_payload_matches_backend_contract():
    meeting_id = uuid4()
    job_id = uuid4()
    speaker_id = uuid4()

    segment = make_segment(
        0.0,
        2.5,
        "Xin chào mọi người.",
    )

    payload = build_transcript_payload(
        meeting_id=meeting_id,
        processing_job_id=job_id,
        segments=[segment],
        speaker_ids={0: speaker_id},
    )

    result = payload.model_dump(mode="json")

    assert result == {
        "meetingId": str(meeting_id),
        "processingJobId": str(job_id),
        "success": True,
        "language": "vi",
        "modelName": "whisper",
        "segments": [
            {
                "speakerId": str(speaker_id),
                "startTimeMs": 0,
                "endTimeMs": 2500,
                "text": "Xin chào mọi người.",
            }
        ],
    }


def test_schema_rejects_invalid_segment():
    with pytest.raises(ValidationError):
        TranscriptSegment(
            speakerId=None,
            startTimeMs=3000,
            endTimeMs=1000,
            text="Sai timestamp",
        )
