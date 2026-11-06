"""Unit tests cho Speaker–Transcript Alignment."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.speaker_transcript_aligner import align_speakers, analyze_speaker_attribution


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


def test_single_speaker_with_small_timestamp_boundary_drift_is_attributed():
    speaker_id = uuid4()
    analysis = analyze_speaker_attribution(
        [whisper(15.980, 17.880)],
        [diar(15.961, 17.868, "SPEAKER_00", "Speaker 1")],
    )[0]

    assert analysis.status == "ATTRIBUTED"
    assert analysis.speaker_key == "SPEAKER_00"
    assert align_speakers(
        [whisper(15.980, 17.880)],
        [diar(15.961, 17.868, "SPEAKER_00", "Speaker 1")],
        {"SPEAKER_00": speaker_id},
    ) == {0: speaker_id}


def test_same_speaker_turns_require_ninety_percent_union_coverage():
    mostly_covered = analyze_speaker_attribution(
        [whisper(0.05, 1.95)],
        [diar(0.0, 1.0, "A", "Speaker 1"), diar(1.1, 2.0, "A", "Speaker 1")],
    )[0]
    insufficient = analyze_speaker_attribution(
        [whisper(28.7, 33.4)],
        [
            diar(28.938, 30.220, "SPEAKER_00", "Speaker 1"),
            diar(31.385, 35.215, "SPEAKER_00", "Speaker 1"),
        ],
    )[0]

    assert mostly_covered.status == "ATTRIBUTED"
    assert mostly_covered.speaker_key == "A"
    assert insufficient.status == "UNRESOLVED"
    assert insufficient.speaker_key is None


def test_distinct_speaker_overlap_is_never_resolved_by_percentage():
    analysis = analyze_speaker_attribution(
        [whisper(0.0, 4.0)],
        [diar(0.0, 3.9, "A", "Speaker 1"), diar(3.9, 4.0, "B", "Speaker 2")],
    )[0]

    assert analysis.status == "CROSS_SPEAKER_BOUNDARY"
    assert analysis.speaker_key is None


def test_failing_job_segments_recover_strong_matches_and_keep_low_coverage_unknown():
    transcript_intervals = [
        (0.800, 4.820), (5.440, 10.120), (10.820, 14.700), (15.980, 17.880),
        (18.780, 21.280), (22.200, 28.200), (28.700, 33.400), (33.600, 35.200),
    ]
    diarization = [
        diar(1.077, 4.874, "SPEAKER_00", "Speaker 1"),
        diar(5.600, 10.190, "SPEAKER_00", "Speaker 1"),
        diar(10.780, 14.797, "SPEAKER_00", "Speaker 1"),
        diar(15.961, 17.868, "SPEAKER_00", "Speaker 1"),
        diar(18.745, 21.412, "SPEAKER_00", "Speaker 1"),
        diar(22.205, 28.347, "SPEAKER_00", "Speaker 1"),
        diar(28.938, 30.220, "SPEAKER_00", "Speaker 1"),
        diar(31.385, 35.215, "SPEAKER_00", "Speaker 1"),
    ]

    result = analyze_speaker_attribution(
        [whisper(start, end) for start, end in transcript_intervals], diarization,
    )

    assert [result[index].status for index in range(8)] == [
        "ATTRIBUTED", "ATTRIBUTED", "ATTRIBUTED", "ATTRIBUTED",
        "ATTRIBUTED", "ATTRIBUTED", "UNRESOLVED", "ATTRIBUTED",
    ]
    assert result[6].speaker_key is None


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


def test_word_timestamps_resolve_segment_crossing_speaker_boundary():
    speaker_a, speaker_b = uuid4(), uuid4()
    segment = SimpleNamespace(
        start=0.0, end=4.0,
        words=[SimpleNamespace(start=0.2, end=1.0), SimpleNamespace(start=3.0, end=3.8)],
    )
    result = align_speakers(
        [segment],
        [diar(0, 2, "A", "Speaker A"), diar(2, 4, "B", "Speaker B")],
        {"A": speaker_a, "B": speaker_b},
    )
    assert result == {0: None}


def test_word_timestamps_without_word_text_do_not_force_whole_crossing_sentence_to_majority_speaker():
    speaker_a, speaker_b = uuid4(), uuid4()
    segment = SimpleNamespace(
        start=0.0, end=4.0,
        words=[SimpleNamespace(start=0.2, end=1.2), SimpleNamespace(start=1.5, end=1.9)],
    )
    result = align_speakers(
        [segment],
        [diar(0, 2, "A", "Speaker A"), diar(2, 4, "B", "Speaker B")],
        {"A": speaker_a, "B": speaker_b},
    )
    assert result == {0: None}


def test_word_timing_outside_whisper_bounds_is_ignored_and_uses_segment_bounds():
    speaker_a = uuid4()
    segment = SimpleNamespace(start=1.0, end=2.0, words=[SimpleNamespace(start=4.0, end=5.0)])
    result = align_speakers(
        [segment], [diar(0.0, 3.0, "A", "Speaker A")], {"A": speaker_a},
    )
    assert result == {0: speaker_a}


def test_overlapping_speakers_with_equal_evidence_remain_unresolved():
    result = align_speakers(
        [whisper(1.0, 3.0)],
        [diar(0.0, 2.0, "A", "Speaker A"), diar(2.0, 4.0, "B", "Speaker B")],
        {"A": uuid4(), "B": uuid4()},
    )
    assert result == {0: None}


def test_alignment_repeated_runs_are_deterministic():
    speaker_a, speaker_b = uuid4(), uuid4()
    segments = [whisper(0.0, 1.5), whisper(2.5, 4.0)]
    timeline = [diar(0, 2, "A", "Speaker A"), diar(2, 4, "B", "Speaker B")]
    mapping = {"A": speaker_a, "B": speaker_b}
    assert align_speakers(segments, timeline, mapping) == align_speakers(segments, timeline, mapping)


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


def test_full_containment_assigns_speaker_and_boundary_crossing_is_explicitly_ambiguous():
    contained = whisper(18.2, 19.0)
    crossing = whisper(17.5, 18.5)
    timeline = [
        diar(12.620, 18.037, "SPEAKER_03", "Speaker 4"),
        diar(18.037, 22.002, "SPEAKER_02", "Speaker 2"),
    ]
    analysis = analyze_speaker_attribution([contained, crossing], timeline)
    assert analysis[0].status == "ATTRIBUTED"
    assert analysis[0].speaker_key == "SPEAKER_02"
    assert analysis[1].status == "CROSS_SPEAKER_BOUNDARY"
    assert analysis[1].speaker_key is None
    assert analysis[1].overlap_by_speaker == {
        "SPEAKER_03": pytest.approx(0.537),
        "SPEAKER_02": pytest.approx(0.463),
    }


def test_segment_starting_before_largest_overlap_speaker_is_not_mislabeled():
    segment = whisper(17.5, 19.0)
    timeline = [
        diar(17.5, 18.037, "SPEAKER_02", "Speaker 2"),
        diar(18.037, 19.0, "SPEAKER_03", "Speaker 4"),
    ]
    analysis = analyze_speaker_attribution([segment], timeline)[0]
    assert analysis.overlap_by_speaker["SPEAKER_03"] > analysis.overlap_by_speaker["SPEAKER_02"]
    assert analysis.status == "CROSS_SPEAKER_BOUNDARY"
    assert analysis.speaker_key is None


def test_silence_and_exact_boundary_are_not_misattributed():
    timeline = [diar(0.0, 2.0, "A", "Speaker A"), diar(2.0, 4.0, "B", "Speaker B")]
    analysis = analyze_speaker_attribution([whisper(1.0, 2.0), whisper(4.0, 5.0)], timeline)
    assert analysis[0].status == "ATTRIBUTED" and analysis[0].speaker_key == "A"
    assert analysis[1].status == "UNRESOLVED" and analysis[1].speaker_key is None


def test_reliable_word_timestamps_provide_actual_split_ranges_and_speaker_keys():
    segment = SimpleNamespace(
        start=0.0, end=2.0, text="Hi there",
        words=[SimpleNamespace(start=0.2, end=0.8, word="Hi "),
               SimpleNamespace(start=1.2, end=1.8, word="there")],
    )
    analysis = analyze_speaker_attribution(
        [segment], [diar(0.0, 1.0, "A", "Speaker A"), diar(1.0, 2.0, "B", "Speaker B")]
    )[0]
    assert analysis.status == "WORD_LEVEL_SPLIT"
    assert analysis.word_assignments == ((0.2, 0.8, "Hi ", "A"), (1.2, 1.8, "there", "B"))


def test_persisted_job_9bc97f6a_transcript_segments_are_checked_against_exclusive_turns():
    # Timestamp-only regression fixture captured from PostgreSQL; transcript text is omitted.
    diarization = [
        diar(.132, 8.587, "SPEAKER_1", "Speaker 1"),
        diar(9.683, 11.371, "SPEAKER_3", "Speaker 3"),
        diar(12.620, 18.037, "SPEAKER_3", "Speaker 3"),
        diar(18.037, 22.002, "SPEAKER_4", "Speaker 4"),
        diar(22.002, 22.087, "SPEAKER_2", "Speaker 2"),
        diar(22.087, 22.120, "SPEAKER_4", "Speaker 4"),
        diar(22.120, 25.968, "SPEAKER_2", "Speaker 2"),
        diar(25.968, 26.356, "SPEAKER_5", "Speaker 5"),
        diar(26.862, 29.900, "SPEAKER_5", "Speaker 5"),
    ]
    persisted = [
        (0.000, 6.840), (6.840, 11.620), (11.620, 17.880), (17.880, 21.800),
        (21.800, 22.740), (23.060, 26.340), (26.340, 29.760), (29.760, 30.460),
    ]
    segments = [whisper(start, end) for start, end in persisted]
    result = analyze_speaker_attribution(segments, diarization)
    assert [result[index].status for index in range(len(persisted))] == [
        "ATTRIBUTED", "CROSS_SPEAKER_BOUNDARY", "UNRESOLVED", "CROSS_SPEAKER_BOUNDARY",
        "CROSS_SPEAKER_BOUNDARY", "CROSS_SPEAKER_BOUNDARY", "UNRESOLVED", "UNRESOLVED",
    ]
    assert result[1].overlap_by_speaker == {
        "SPEAKER_1": pytest.approx(1.747), "SPEAKER_3": pytest.approx(1.688),
    }
    assert result[3].overlap_by_speaker == {
        "SPEAKER_3": pytest.approx(.157), "SPEAKER_4": pytest.approx(3.763),
    }
    assert result[4].overlap_by_speaker == {
        "SPEAKER_2": pytest.approx(.705), "SPEAKER_4": pytest.approx(.235),
    }
    assert result[5].overlap_by_speaker == {
        "SPEAKER_2": pytest.approx(2.908), "SPEAKER_5": pytest.approx(.372),
    }


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
