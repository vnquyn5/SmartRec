"""Unit tests cho Speaker–Transcript Alignment."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.speaker_transcript_aligner import align_speakers


def whisper(start, end):
    return SimpleNamespace(start=start, end=end)


def diar(start, end, raw_id, label):
    return SimpleNamespace(
        start_seconds=start,
        end_seconds=end,
        raw_speaker_id=raw_id,
        speaker=label,
    )


def test_single_speaker():
    speaker_id = uuid4()

    result = align_speakers(
        [whisper(1, 3)],
        [diar(0, 4, "SPEAKER_00", "Speaker 1")],
        {"SPEAKER_00": speaker_id},
    )

    assert result == {0: speaker_id}


def test_multiple_speakers_by_overlap():
    speaker_1 = uuid4()
    speaker_2 = uuid4()

    result = align_speakers(
        [whisper(0, 2), whisper(3, 5)],
        [
            diar(0, 2.5, "SPEAKER_00", "Speaker 1"),
            diar(2.5, 5.5, "SPEAKER_01", "Speaker 2"),
        ],
        {
            "SPEAKER_00": speaker_1,
            "SPEAKER_01": speaker_2,
        },
    )

    assert result == {0: speaker_1, 1: speaker_2}


def test_no_overlap():
    result = align_speakers(
        [whisper(10, 12)],
        [diar(0, 3, "SPEAKER_00", "Speaker 1")],
        {"SPEAKER_00": uuid4()},
    )

    assert result == {0: None}


def test_equal_overlap_returns_none():
    result = align_speakers(
        [whisper(0, 4)],
        [
            diar(0, 2, "SPEAKER_00", "Speaker 1"),
            diar(2, 4, "SPEAKER_01", "Speaker 2"),
        ],
        {
            "SPEAKER_00": uuid4(),
            "SPEAKER_01": uuid4(),
        },
    )

    assert result == {0: None}


def test_mapping_by_friendly_label():
    speaker_id = uuid4()

    result = align_speakers(
        [whisper(1, 2)],
        [diar(0, 3, "SPEAKER_00", "Speaker 1")],
        {"Speaker 1": speaker_id},
    )

    assert result == {0: speaker_id}


def test_missing_uuid_returns_none():
    result = align_speakers(
        [whisper(1, 2)],
        [diar(0, 3, "SPEAKER_00", "Speaker 1")],
        {},
    )

    assert result == {0: None}


@pytest.mark.parametrize(
    "start,end",
    [
        (-1, 2),
        (5, 3),
        (float("nan"), 2),
        (1, float("inf")),
    ],
)
def test_invalid_whisper_timestamps(start, end):
    with pytest.raises(ValueError):
        align_speakers(
            [whisper(start, end)],
            [],
            {},
        )


def test_invalid_diarization_timestamps():
    with pytest.raises(ValueError):
        align_speakers(
            [whisper(0, 2)],
            [diar(3, 1, "SPEAKER_00", "Speaker 1")],
            {},
        )
