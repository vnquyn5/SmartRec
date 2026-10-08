import os
import sys
import tempfile
import wave
import shutil
from pathlib import Path
from unittest.mock import patch

# Nạp thư mục gốc vào sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pyannote.core import Annotation, Segment
from app.services.speaker_diarizer import (
    SpeakerDiarizationService,
    format_timestamp,
    speaker_diarization_service
)


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
        with patch("app.services.speaker_diarizer.diarization_runtime.diarize", return_value=empty_annotation):
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

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize", return_value=mock_annotation):
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


def test_overlapping_speech_collar_merging():
    """
    Kiểm chứng xử lý chồng lấn (Overlapping Speech) & Chen ngang:
    - Speaker A có turn [1.0, 4.0]
    - Speaker B chen ngang / chồng lấn [2.0, 3.0]
    - Speaker A nói tiếp [4.2, 5.5] (ngắt 0.2s <= collar 0.5s so với turn trước của A)
    Kết quả:
    - A phải được gộp thành [1.0, 5.5]
    - B giữ nguyên [2.0, 3.0]
    - Thứ tự emit tăng dần theo start_time: Seg 1 (A: [1.0, 5.5]), Seg 2 (B: [2.0, 3.0])
    """
    test_dir = tempfile.mkdtemp(prefix="test_diar_overlap_")
    try:
        dummy_wav = os.path.join(test_dir, "overlap.wav")
        create_mock_wav_file(dummy_wav, duration_seconds=6.0)

        mock_annotation = Annotation()
        mock_annotation[Segment(1.0, 4.0)] = "SPEAKER_A"
        mock_annotation[Segment(2.0, 3.0)] = "SPEAKER_B"
        mock_annotation[Segment(4.2, 5.5)] = "SPEAKER_A"

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize", return_value=mock_annotation):
            res = speaker_diarization_service.segment_speech(
                dummy_wav,
                collar_merge_gap=0.5,
                min_speech_duration=0.2
            )
            assert res.status == "SUCCESS"
            assert res.total_segments == 2
            assert res.unique_speakers == ["SPEAKER_A", "SPEAKER_B"]

            seg1 = res.segments[0]
            assert seg1.speaker == "SPEAKER_A"
            assert seg1.start_seconds == 1.0 and seg1.end_seconds == 5.5
            assert seg1.duration_seconds == 4.5

            seg2 = res.segments[1]
            assert seg2.speaker == "SPEAKER_B"
            assert seg2.start_seconds == 2.0 and seg2.end_seconds == 3.0
            assert seg2.duration_seconds == 1.0
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

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize", return_value=mock_annotation):
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

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize", return_value=mock_annotation):
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

        with patch("app.services.speaker_diarizer.diarization_runtime.diarize", return_value=mock_annotation):
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
