from app.services.speaker_turn_postprocessor import consolidate_speaker_turns


def test_merges_same_speaker_across_short_pause():
    assert consolidate_speaker_turns(
        [(1.0, 2.0, "A"), (2.2, 3.0, "A")], max_gap=0.3, audio_duration=4.0
    ) == [(1.0, 3.0, "A")]


def test_does_not_bridge_another_speaker_in_the_gap():
    assert consolidate_speaker_turns(
        [(1.0, 2.0, "A"), (2.1, 2.4, "B"), (2.5, 3.5, "A")],
        max_gap=0.6,
        audio_duration=4.0,
    ) == [(1.0, 2.0, "A"), (2.1, 2.4, "B"), (2.5, 3.5, "A")]


def test_preserves_overlap_and_short_turns_and_clamps_to_duration():
    assert consolidate_speaker_turns(
        [(-0.1, 0.1, "A"), (0.05, 0.2, "B"), (3.9, 4.2, "C"),
         (1.0, 1.0, "D"), (0.2, 0.3, None)],
        max_gap=0.1,
        audio_duration=4.0,
    ) == [(0.0, 0.1, "A"), (0.05, 0.2, "B"), (3.9, 4.0, "C")]


def test_does_not_merge_across_long_silence_and_rejects_bad_threshold():
    assert consolidate_speaker_turns(
        [(0.0, 1.0, "A"), (2.0, 2.1, "A")], max_gap=0.5, audio_duration=3.0
    ) == [(0.0, 1.0, "A"), (2.0, 2.1, "A")]
    try:
        consolidate_speaker_turns([], max_gap=-0.1, audio_duration=3.0)
        assert False, "negative merge threshold should be rejected"
    except ValueError:
        pass
