import os
import sys
import tempfile
import wave
import shutil
import pytest
from pathlib import Path
from unittest.mock import patch

# Nạp thư mục gốc vào sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pyannote.core import Annotation, Segment
from app.services.speaker_diarizer import (
    SpeakerDiarizationService,
    annotation_to_speaker_segments,
    calculate_overlap_duration,
    format_timestamp,
    merge_speaker_turns,
    resolve_speaker_count_constraints,
    validate_exclusive_annotation,
    detect_speaker_turn_fragments,
    speaker_diarization_service
)
from app.services.diarization_runtime import DiarizationOutput
from app.schemas.diarization_schemas import SpeakerSegment


def diarization_output(annotation, exclusive=None, error=None):
    return DiarizationOutput(annotation, exclusive, "DiarizeOutput" if exclusive is not None else "Annotation", error)


def create_mock_wav_file(file_path: str, duration_seconds: float = 1.0, sample_rate: int = 16000):
    """Tạo tệp WAV PCM 16-bit hợp lệ phục vụ kiểm thử cô lập."""
    num_frames = int(sample_rate * duration_seconds)
    with wave.open(file_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * num_frames)


def test_format_timestamp_helper():
    assert format_timestamp(0.0) == "00:00:00.000"
    assert format_timestamp(47.72) == "00:00:47.720"
    assert format_timestamp(3661.125) == "01:01:01.125"
    assert format_timestamp(7322.05) == "02:02:02.050"


def test_file_not_found_handling():
    res = speaker_diarization_service.segment_speech("non_existent_path.wav", job_id="JOB-404")
    assert res.status == "FAILED"
    assert "không tồn tại" in res.error_message
    assert res.total_segments == 0


def test_invalid_audio_format():
    test_dir = tempfile.mkdtemp(prefix="test_diar_corrupt_")
    try:
        corrupt_file = os.path.join(test_dir, "corrupt.wav")
        with open(corrupt_file, "wb") as f:
            f.write(b"INVALID_HEADER_DATA_NOT_WAV")

        res = speaker_diarization_service.segment_speech(corrupt_file, job_id="JOB-CORRUPT")
        assert res.status == "FAILED"
        assert "Lỗi đọc định dạng audio" in res.error_message
        assert res.total_segments == 0
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_silent_audio_no_speech():
    test_dir = tempfile.mkdtemp(prefix="test_diar_silent_")
    try:
        dummy_wav = os.path.join(test_dir, "silent.wav")
        create_mock_wav_file(dummy_wav, duration_seconds=2.0)

        empty_annotation = Annotation()
        with patch("app.services.speaker_diarizer.diarization_runtime.diarize_with_output", return_value=diarization_output(empty_annotation)):
            res = speaker_diarization_service.segment_speech(dummy_wav, job_id="JOB-SILENT")
            assert res.status == "NO_SPEECH_DETECTED"
            assert res.total_segments == 0
            assert res.speech_duration_seconds == 0.0
            assert len(res.segments) == 0
            assert len(res.unique_speakers) == 0
            assert len(res.vad_intervals) == 0
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_collar_merging_before_filtering():
    """
    Hai turn liên tiếp cùng SPEAKER_00 mỗi turn 0.15s (< 0.2s), ngắt nghỉ 0.1s (<= 0.5s).
    Gộp trước khi lọc giúp bảo toàn thành segment 0.4s hợp lệ.
    """
    test_dir = tempfile.mkdtemp(prefix="test_diar_merge_first_")
    try:
        dummy_wav = os.path.join(test_dir, "test_audio.wav")
        create_mock_wav_file(dummy_wav, duration_seconds=5.0)

        mock_annotation = Annotation()
        mock_annotation[Segment(1.0, 1.15)] = "SPEAKER_00"  # 0.15s
        mock_annotation[Segment(1.25, 1.40)] = "SPEAKER_00" # 0.15s, ngắt 0.1s

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize_with_output", return_value=diarization_output(mock_annotation)):
            res = speaker_diarization_service.segment_speech(
                dummy_wav,
                min_speech_duration=0.2,
                collar_merge_gap=0.5
            )
            assert res.status == "SUCCESS"
            assert res.total_segments == 1
            seg = res.segments[0]
            assert seg.start_seconds == 1.0 and seg.end_seconds == 1.40
            assert seg.duration_seconds == 0.40
            assert seg.speaker == "SPEAKER_00"
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_same_speaker_pause_merges_without_another_turn_in_gap():
    assert merge_speaker_turns([
        (1.0, 1.15, "A"), (1.25, 1.40, "A"),
    ], 0.5) == [(1.0, 1.4, "A")]


def test_same_speaker_is_not_merged_across_another_speakers_interruption():
    assert merge_speaker_turns([
        (1.0, 2.5, "A"), (2.5, 2.9, "B"), (2.9, 4.5, "A"),
    ], 0.5) == [
        (1.0, 2.5, "A"), (2.5, 2.9, "B"), (2.9, 4.5, "A"),
    ]


def test_short_other_speaker_interruption_blocks_collar_merge():
    assert merge_speaker_turns([
        (1.0, 2.0, "A"), (2.1, 2.2, "B"), (2.3, 3.0, "A"),
    ], 0.5) == [
        (1.0, 2.0, "A"), (2.1, 2.2, "B"), (2.3, 3.0, "A"),
    ]


def test_merge_preserves_explicit_simultaneous_speech():
    assert merge_speaker_turns([
        (1.0, 2.5, "A"), (2.0, 2.3, "B"), (2.6, 3.5, "A"),
    ], 0.5) == [
        (1.0, 3.5, "A"), (2.0, 2.3, "B"),
    ]


def test_overlap_diagnostic_measures_active_speaker_time_not_pair_count():
    assert calculate_overlap_duration([
        (1.0, 3.0, "A"), (2.0, 4.0, "B"), (2.5, 3.5, "C"),
    ]) == 1.5


def test_merge_drops_invalid_and_zero_length_segments():
    assert merge_speaker_turns([(2.0, 2.0, "A"), (3.0, 2.0, "B")], 0.5) == []


def test_speaker_count_constraints_are_optional_and_validated():
    assert resolve_speaker_count_constraints() == ({}, "automatic")
    assert resolve_speaker_count_constraints(num_speakers=3) == ({"num_speakers": 3}, "exact")
    assert resolve_speaker_count_constraints(min_speakers=2, max_speakers=4) == (
        {"min_speakers": 2, "max_speakers": 4}, "bounded"
    )
    for kwargs in (
        {"num_speakers": 0}, {"num_speakers": True},
        {"num_speakers": 2, "min_speakers": 1},
        {"min_speakers": 4, "max_speakers": 2},
    ):
        try:
            resolve_speaker_count_constraints(**kwargs)
            assert False, f"Expected invalid constraints: {kwargs}"
        except ValueError:
            pass


def test_timeline_mode_defaults_to_raw_and_rejects_unknown_values():
    from pydantic import ValidationError
    from app.core.config import Settings

    assert Settings(_env_file=None).pyannote_timeline_mode == "raw"
    assert Settings(_env_file=None).pyannote_turn_smoothing_enabled is False
    assert Settings(_env_file=None).pyannote_turn_smoothing_max_fragment_ms == 150
    with pytest.raises(ValidationError):
        Settings(_env_file=None, pyannote_timeline_mode="silently-pick-a-winner")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, pyannote_turn_smoothing_max_fragment_ms=0)


def test_exact_speaker_count_is_forwarded_to_pyannote(tmp_path):
    dummy_wav = tmp_path / "count.wav"
    create_mock_wav_file(str(dummy_wav), duration_seconds=2.0)
    annotation = Annotation()
    annotation[Segment(0.2, 1.0)] = "SPEAKER_00"
    with patch("app.services.speaker_diarizer.diarization_runtime.diarize_with_output", return_value=diarization_output(annotation)) as diarize:
        result = SpeakerDiarizationService().segment_speech(str(dummy_wav), num_speakers=1)
    assert result.status == "SUCCESS"
    diarize.assert_called_once_with(str(dummy_wav), num_speakers=1)


def test_exclusive_request_fails_explicitly_when_pipeline_only_returns_legacy_annotation(tmp_path):
    dummy_wav = tmp_path / "legacy.wav"
    create_mock_wav_file(str(dummy_wav), duration_seconds=2.0)
    annotation = Annotation()
    annotation[Segment(0.1, 1.0)] = "SPEAKER_00"
    with patch("app.services.speaker_diarizer.diarization_runtime.diarize_with_output", return_value=diarization_output(annotation)):
        result = SpeakerDiarizationService().segment_speech(str(dummy_wav), timeline_mode="exclusive")
    assert result.status == "FAILED"
    assert result.error_code == "EXCLUSIVE_DIARIZATION_UNAVAILABLE"
    assert result.timeline_source == "unavailable"
    assert [(s.start_seconds, s.end_seconds, s.speaker) for s in result.raw_segments] == [
        (0.1, 1.0, "SPEAKER_00"),
    ]


def test_enabled_smoothing_is_diagnostic_only_and_keeps_native_selection(tmp_path, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "pyannote_turn_smoothing_enabled", True)
    monkeypatch.setattr(settings, "pyannote_turn_smoothing_max_fragment_ms", 150)
    wav = tmp_path / "smoothing.wav"
    create_mock_wav_file(str(wav), duration_seconds=5.0)
    raw, exclusive = Annotation(), Annotation()
    raw[Segment(1.0, 1.3)] = "SPEAKER_A"
    raw[Segment(1.08, 1.12)] = "SPEAKER_B"
    exclusive[Segment(1.0, 1.085)] = "SPEAKER_A"
    exclusive[Segment(1.085, 1.118)] = "SPEAKER_B"
    exclusive[Segment(1.118, 1.3)] = "SPEAKER_A"
    with patch("app.services.speaker_diarizer.diarization_runtime.diarize_with_output",
               return_value=diarization_output(raw, exclusive)):
        result = SpeakerDiarizationService().segment_speech(str(wav), timeline_mode="exclusive")
    assert result.status == "SUCCESS"
    assert result.smoothing_enabled is True
    assert result.timeline_source == "native_exclusive_diagnostics_only"
    chosen = [(item.speaker, item.start_seconds, item.end_seconds) for item in result.segments]
    native = [(item.speaker, item.start_seconds, item.end_seconds) for item in result.native_exclusive_segments]
    assert chosen == native
    assert [(item.speaker, item.start_seconds, item.end_seconds) for item in result.smoothed_segments] == native
    assert any(item.pattern == "ABA_MICRO_TURN" for item in result.smoothing_diagnostics)


def test_exclusive_validation_rejects_invented_speakers_and_cross_speaker_overlap():
    raw_ids = {"SPEAKER_A", "SPEAKER_B"}
    invalid = Annotation()
    invalid[Segment(1.0, 2.0)] = "SPEAKER_A"
    invalid[Segment(1.5, 2.5)] = "SPEAKER_B"
    try:
        validate_exclusive_annotation(invalid, raw_ids, 3.0)
        assert False, "Expected overlapping native exclusive output to be rejected"
    except ValueError as exc:
        assert "cross-speaker overlap" in str(exc)

    invented = Annotation()
    invented[Segment(1.0, 2.0)] = "SPEAKER_C"
    try:
        validate_exclusive_annotation(invented, raw_ids, 3.0)
        assert False, "Expected an invented identity to be rejected"
    except ValueError as exc:
        assert "invented speaker ID" in str(exc)


def test_exclusive_validation_keeps_short_turns_boundaries_and_silence_gaps():
    native = Annotation()
    native[Segment(0.0, 0.512)] = "SPEAKER_A"
    native[Segment(0.512, 0.604)] = "SPEAKER_B"
    native[Segment(1.2, 1.8)] = "SPEAKER_A"
    turns = validate_exclusive_annotation(native, {"SPEAKER_A", "SPEAKER_B"}, 2.0)
    assert turns == [
        (0.0, 0.512, "SPEAKER_A"),
        (0.512, 0.604, "SPEAKER_B"),
        (1.2, 1.8, "SPEAKER_A"),
    ]
    assert validate_exclusive_annotation(native, {"SPEAKER_A", "SPEAKER_B"}, 2.0) == turns


def test_turn_smoothing_diagnostics_detect_aba_but_preserve_the_native_intervals():
    def turn(index, speaker, start, end):
        return SpeakerSegment(
            segment_id=index, speaker=speaker, start_seconds=start, end_seconds=end,
            duration_seconds=round(end-start, 3), start_time=format_timestamp(start), end_time=format_timestamp(end),
        )

    native = [turn(1, "SPEAKER_A", 22.002, 22.087), turn(2, "SPEAKER_B", 22.087, 22.120),
              turn(3, "SPEAKER_A", 22.120, 25.968)]
    raw = [turn(1, "SPEAKER_A", 21.9, 22.2), turn(2, "SPEAKER_B", 22.08, 22.11)]
    before = [(item.speaker, item.start_seconds, item.end_seconds) for item in native]
    diagnostics = detect_speaker_turn_fragments(native, raw, 150)
    aba = next(item for item in diagnostics if item.candidate_speaker == "SPEAKER_B")
    assert aba.pattern == "ABA_MICRO_TURN"
    assert aba.duration_ms == 33.0
    assert aba.silent_gap_before_ms == aba.silent_gap_after_ms == 0.0
    assert aba.raw_overlap_speakers == ["SPEAKER_A"]
    assert aba.resolution_status == "PRESERVED"
    assert aba.reason_code == "INSUFFICIENT_ACOUSTIC_EVIDENCE"
    assert [(item.speaker, item.start_seconds, item.end_seconds) for item in native] == before


def test_turn_smoothing_diagnostics_ignore_long_turns_and_preserve_silence_gap():
    def turn(index, speaker, start, end):
        return SpeakerSegment(segment_id=index, speaker=speaker, start_seconds=start, end_seconds=end,
                              duration_seconds=end-start, start_time=format_timestamp(start), end_time=format_timestamp(end))
    native = [turn(1, "A", 0.0, 1.0), turn(2, "B", 1.0, 1.2), turn(3, "A", 1.5, 2.0)]
    assert detect_speaker_turn_fragments(native, [], 150) == []


def test_turn_smoothing_diagnostics_cover_empty_single_invalid_and_rapid_sequences():
    def turn(index, speaker, start, end):
        return SpeakerSegment(segment_id=index, speaker=speaker, start_seconds=start, end_seconds=end,
                              duration_seconds=end-start, start_time=format_timestamp(start), end_time=format_timestamp(end))
    assert detect_speaker_turn_fragments([], [], 150) == []
    assert detect_speaker_turn_fragments([turn(1, "A", 0.0, 1.0)], [], 150) == []
    assert detect_speaker_turn_fragments([turn(1, "A", 0.0, 0.0)], [], 150) == []
    turns = [turn(1, "A", 0.0, .08), turn(2, "B", .08, .16), turn(3, "A", .16, .24),
             turn(4, "B", .24, .32), turn(5, "A", .32, 1.0)]
    diagnostics = detect_speaker_turn_fragments(turns, [], 150)
    assert diagnostics
    assert diagnostics[0].pattern == "RAPID_SWITCH_SEQUENCE"
    assert diagnostics[0].rapid_change_count >= 3
    assert all(item.resolution_status == "PRESERVED" for item in diagnostics)
    assert detect_speaker_turn_fragments(turns, [], 150) == diagnostics


KNOWN_JOB_RAW_TURNS = [
    (0.132, 8.587, "SPEAKER_04"),
    (1.178, 3.271, "SPEAKER_00"),
    (3.912, 4.030, "SPEAKER_00"),
    (4.317, 4.570, "SPEAKER_00"),
    (5.431, 5.718, "SPEAKER_03"),
    (9.683, 11.371, "SPEAKER_03"),
    (12.620, 18.037, "SPEAKER_03"),
    (18.037, 22.002, "SPEAKER_02"),
    (21.580, 21.783, "SPEAKER_01"),
    (22.002, 22.087, "SPEAKER_00"),
    (22.087, 22.120, "SPEAKER_02"),
    (22.120, 25.968, "SPEAKER_00"),
    (25.968, 26.356, "SPEAKER_01"),
    (26.862, 29.900, "SPEAKER_01"),
]


def test_known_job_raw_overlap_fixture_recomputes_full_overlap_duration_and_is_unchanged():
    annotation = Annotation()
    for start, end, speaker in KNOWN_JOB_RAW_TURNS:
        annotation[Segment(start, end)] = speaker
    before = [(segment.start, segment.end, speaker)
              for segment, _, speaker in annotation.itertracks(yield_label=True)]
    preserved = annotation_to_speaker_segments(annotation)
    after = [(segment.start_seconds, segment.end_seconds, segment.speaker)
             for segment in preserved]
    assert len(after) == 14
    assert len({speaker for _, _, speaker in after}) == 5
    assert before == after
    # The three user-confirmed intervals total 2.583s. The complete fixture
    # also includes two further SPEAKER_04/SPEAKER_00 overlaps: 0.118 + 0.253s.
    assert calculate_overlap_duration(KNOWN_JOB_RAW_TURNS) == 2.954
    assert [
        round(min(left[1], right[1]) - max(left[0], right[0]), 3)
        for index, left in enumerate(KNOWN_JOB_RAW_TURNS)
        for right in KNOWN_JOB_RAW_TURNS[index + 1:]
        if left[2] != right[2] and min(left[1], right[1]) > max(left[0], right[0])
    ] == [2.093, 0.118, 0.253, 0.287, 0.203]


def test_overlapping_speech_collar_merging():
    """
    Kiểm chứng xử lý chồng lấn (Overlapping Speech) & Chen ngang:
    - Speaker A có turn [1.0, 4.0]
    - Speaker B chen ngang / chồng lấn [2.0, 3.0]
    - Speaker A nói tiếp [4.2, 5.5] (ngắt 0.2s <= collar 0.5s so với turn trước của A)
    Kết quả: A được gộp qua khoảng nghỉ không có speaker khác, còn phần chồng lấn
    A/B vẫn được giữ vì annotation đầu vào xác nhận nó.
    """
    test_dir = tempfile.mkdtemp(prefix="test_diar_overlap_")
    try:
        dummy_wav = os.path.join(test_dir, "overlap.wav")
        create_mock_wav_file(dummy_wav, duration_seconds=6.0)

        mock_annotation = Annotation()
        mock_annotation[Segment(1.0, 4.0)] = "SPEAKER_A"
        mock_annotation[Segment(2.0, 3.0)] = "SPEAKER_B"
        mock_annotation[Segment(4.2, 5.5)] = "SPEAKER_A"

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize_with_output", return_value=diarization_output(mock_annotation)):
            res = speaker_diarization_service.segment_speech(
                dummy_wav,
                collar_merge_gap=0.5,
                min_speech_duration=0.2
            )
            assert res.status == "SUCCESS"
            assert res.total_segments == 2
            assert res.unique_speakers == ["SPEAKER_A", "SPEAKER_B"]

            assert [(s.speaker, s.start_seconds, s.end_seconds) for s in res.segments] == [
                ("SPEAKER_A", 1.0, 5.5),
                ("SPEAKER_B", 2.0, 3.0),
            ]
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_vad_independence_when_segments_filtered_out():
    """
    VAD Timeline độc lập: dù các phân đoạn ngắn bị lọc hết, VAD intervals vẫn tồn tại.
    """
    test_dir = tempfile.mkdtemp(prefix="test_diar_vad_indep_")
    try:
        dummy_wav = os.path.join(test_dir, "test_audio.wav")
        create_mock_wav_file(dummy_wav, duration_seconds=5.0)

        mock_annotation = Annotation()
        mock_annotation[Segment(1.0, 1.1)] = "SPEAKER_00"
        mock_annotation[Segment(3.0, 3.1)] = "SPEAKER_01"

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize_with_output", return_value=diarization_output(mock_annotation)):
            res = speaker_diarization_service.segment_speech(
                dummy_wav,
                min_speech_duration=0.2,
                collar_merge_gap=0.5
            )
            assert res.total_segments == 0
            assert len(res.segments) == 0
            assert len(res.vad_intervals) == 2
            assert res.speech_duration_seconds == 0.2
            assert res.speech_ratio > 0.0
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_multi_speaker_alternation():
    test_dir = tempfile.mkdtemp(prefix="test_diar_multi_")
    try:
        dummy_wav = os.path.join(test_dir, "multi.wav")
        create_mock_wav_file(dummy_wav, duration_seconds=10.0)

        mock_annotation = Annotation()
        mock_annotation[Segment(0.0, 2.0)] = "SPEAKER_00"
        mock_annotation[Segment(2.5, 4.5)] = "SPEAKER_01"
        mock_annotation[Segment(5.0, 7.0)] = "SPEAKER_00"

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize_with_output", return_value=diarization_output(mock_annotation)):
            res = speaker_diarization_service.segment_speech(dummy_wav)
            assert res.status == "SUCCESS"
            assert res.total_segments == 3
            assert res.unique_speakers == ["SPEAKER_00", "SPEAKER_01"]
            assert res.segments[0].speaker == "SPEAKER_00"
            assert res.segments[1].speaker == "SPEAKER_01"
            assert res.segments[2].speaker == "SPEAKER_00"
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_deterministic_audio_pipeline_end_to_end():
    test_dir = tempfile.mkdtemp(prefix="test_diar_e2e_")
    try:
        sample_rate = 16000
        duration_sec = 8.0
        e2e_wav = os.path.join(test_dir, "e2e_sample.wav")
        create_mock_wav_file(e2e_wav, duration_seconds=duration_sec, sample_rate=sample_rate)

        mock_annotation = Annotation()
        mock_annotation[Segment(0.5, 2.5)] = "SPEAKER_00"
        mock_annotation[Segment(3.0, 5.0)] = "SPEAKER_01"
        mock_annotation[Segment(5.2, 7.0)] = "SPEAKER_01"

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize_with_output", return_value=diarization_output(mock_annotation)):
            res = speaker_diarization_service.segment_speech(e2e_wav, job_id="E2E-DETERMINISTIC")

            assert res.status == "SUCCESS"
            assert res.job_id == "E2E-DETERMINISTIC"
            assert res.audio_duration_seconds == 8.0
            assert res.speech_duration_seconds == 5.8
            assert res.speech_ratio == 0.725
            assert res.total_segments == 2
            assert res.unique_speakers == ["SPEAKER_00", "SPEAKER_01"]

            seg1 = res.segments[0]
            assert seg1.segment_id == 1
            assert seg1.speaker == "SPEAKER_00"
            assert seg1.start_seconds == 0.5 and seg1.end_seconds == 2.5
            assert seg1.duration_seconds == 2.0

            seg2 = res.segments[1]
            assert seg2.segment_id == 2
            assert seg2.speaker == "SPEAKER_01"
            assert seg2.start_seconds == 3.0 and seg2.end_seconds == 7.0
            assert seg2.duration_seconds == 4.0

            assert len(res.vad_intervals) >= 1
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def run_all_segmentation_tests():
    test_format_timestamp_helper()
    test_file_not_found_handling()
    test_invalid_audio_format()
    test_silent_audio_no_speech()
    test_collar_merging_before_filtering()
    test_overlapping_speech_collar_merging()
    test_vad_independence_when_segments_filtered_out()
    test_multi_speaker_alternation()
    test_deterministic_audio_pipeline_end_to_end()


if __name__ == "__main__":
    run_all_segmentation_tests()
    print("ALL_TESTS_EXECUTED_SUCCESSFULLY")
