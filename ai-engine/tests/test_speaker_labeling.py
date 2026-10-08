import os
import sys
import json
import tempfile
import shutil
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schemas.diarization_schemas import (
    SpeakerSegment,
    SpeakerSegmentationResponse,
    SpeechActivityInterval,
    DiarizationExportPayload,
    SpeakerProfile
)
from app.services.speaker_labeling_service import (
    SpeakerLabelingService,
    speaker_labeling_service
)


def create_dummy_segment(seg_id: int, speaker: str, start: float, end: float) -> SpeakerSegment:
    dur = round(end - start, 3)
    return SpeakerSegment(
        segment_id=seg_id,
        speaker=speaker,
        start_seconds=start,
        end_seconds=end,
        duration_seconds=dur,
        start_time=f"00:00:{start:06.3f}",
        end_time=f"00:00:{end:06.3f}"
    )


def test_single_speaker_labeling():
    service = SpeakerLabelingService()
    raw_segments = [
        create_dummy_segment(1, "SPEAKER_00", 0.0, 2.5),
        create_dummy_segment(2, "SPEAKER_00", 3.0, 5.0),
    ]
    mapping = service.generate_speaker_labels(raw_segments)
    assert mapping == {"SPEAKER_00": "Speaker 1"}


def test_multi_speaker_timeline_order():
    service = SpeakerLabelingService()
    raw_segments = [
        create_dummy_segment(1, "SPEAKER_02", 1.0, 3.0),
        create_dummy_segment(2, "SPEAKER_00", 4.0, 6.0),
        create_dummy_segment(3, "SPEAKER_01", 7.0, 9.0),
    ]
    mapping = service.generate_speaker_labels(raw_segments)
    assert mapping["SPEAKER_02"] == "Speaker 1"
    assert mapping["SPEAKER_00"] == "Speaker 2"
    assert mapping["SPEAKER_01"] == "Speaker 3"


def test_speaker_label_consistency():
    service = SpeakerLabelingService()
    raw_segments = [
        create_dummy_segment(1, "SPEAKER_A", 0.0, 2.0),
        create_dummy_segment(2, "SPEAKER_B", 2.5, 4.0),
        create_dummy_segment(3, "SPEAKER_A", 5.0, 7.0),
        create_dummy_segment(4, "SPEAKER_B", 7.5, 9.0),
    ]
    mapping = service.generate_speaker_labels(raw_segments)

    assert mapping["SPEAKER_A"] == "Speaker 1"
    assert mapping["SPEAKER_B"] == "Speaker 2"

    seg_res = SpeakerSegmentationResponse(
        status="SUCCESS",
        audio_duration_seconds=10.0,
        speech_duration_seconds=7.0,
        speech_ratio=0.7,
        total_segments=4,
        unique_speakers=["SPEAKER_A", "SPEAKER_B"],
        segments=raw_segments
    )
    payload = service.build_export_payload(seg_res, "meeting.wav")
    assert payload.timeline[0].speaker == "Speaker 1"
    assert payload.timeline[1].speaker == "Speaker 2"
    assert payload.timeline[2].speaker == "Speaker 1"
    assert payload.timeline[3].speaker == "Speaker 2"


def test_speaker_embeddings_integration_and_status():
    service = SpeakerLabelingService()
    raw_segments = [
        create_dummy_segment(1, "SPEAKER_00", 0.0, 2.0)
    ]
    seg_res = SpeakerSegmentationResponse(
        status="SUCCESS",
        audio_duration_seconds=5.0,
        speech_duration_seconds=2.0,
        speech_ratio=0.4,
        total_segments=1,
        unique_speakers=["SPEAKER_00"],
        segments=raw_segments
    )
    mock_embeddings = {
        "SPEAKER_00": [0.123] * 256
    }
    payload = service.build_export_payload(
        seg_res,
        "sample.wav",
        speaker_embeddings=mock_embeddings
    )

    assert payload.embeddings_status == "COMPLETED"
    assert payload.speakers[0].embedding == [0.123] * 256
    assert payload.timeline[0].embedding == [0.123] * 256


def test_hierarchical_speaker_segment_structure():
    service = SpeakerLabelingService()
    raw_segments = [
        create_dummy_segment(1, "SPEAKER_00", 0.0, 2.0),
        create_dummy_segment(2, "SPEAKER_01", 2.5, 4.5),
        create_dummy_segment(3, "SPEAKER_00", 5.0, 8.0),
    ]
    seg_res = SpeakerSegmentationResponse(
        status="SUCCESS",
        audio_duration_seconds=10.0,
        speech_duration_seconds=7.0,
        speech_ratio=0.7,
        total_segments=3,
        unique_speakers=["SPEAKER_00", "SPEAKER_01"],
        segments=raw_segments
    )
    payload = service.build_export_payload(seg_res, "interview.wav")

    assert payload.total_speakers == 2
    spk1_profile = next(s for s in payload.speakers if s.speaker_label == "Speaker 1")
    assert spk1_profile.total_segments == 2
    assert spk1_profile.total_speech_duration_seconds == 5.0
    assert len(spk1_profile.segments) == 2
    assert spk1_profile.segments[0].start == 0.0 and spk1_profile.segments[0].end == 2.0
    assert spk1_profile.segments[1].start == 5.0 and spk1_profile.segments[1].end == 8.0


def test_timeline_chronological_ordering_and_label_assignment():
    service = SpeakerLabelingService()
    raw_segments = [
        create_dummy_segment(2, "SPEAKER_01", 5.0, 7.0),
        create_dummy_segment(1, "SPEAKER_00", 1.0, 3.0),
    ]

    mapping = service.generate_speaker_labels(raw_segments)
    assert mapping["SPEAKER_00"] == "Speaker 1"
    assert mapping["SPEAKER_01"] == "Speaker 2"

    seg_res = SpeakerSegmentationResponse(
        status="SUCCESS",
        audio_duration_seconds=10.0,
        speech_duration_seconds=4.0,
        speech_ratio=0.4,
        total_segments=2,
        segments=raw_segments
    )
    payload = service.build_export_payload(seg_res, "audio.wav")

    assert payload.timeline[0].start_seconds == 1.0
    assert payload.timeline[0].speaker == "Speaker 1"
    assert payload.timeline[0].segment_id == 1

    assert payload.timeline[1].start_seconds == 5.0
    assert payload.timeline[1].speaker == "Speaker 2"
    assert payload.timeline[1].segment_id == 2


def test_no_speech_detected_export():
    service = SpeakerLabelingService()
    seg_res = SpeakerSegmentationResponse(
        status="NO_SPEECH_DETECTED",
        audio_duration_seconds=15.0,
        speech_duration_seconds=0.0,
        speech_ratio=0.0,
        total_segments=0,
        unique_speakers=[],
        segments=[]
    )
    payload = service.build_export_payload(seg_res, "silence.wav")

    assert payload.status == "NO_SPEECH_DETECTED"
    assert payload.total_speakers == 0
    assert payload.embeddings_status == "NOT_AVAILABLE"
    assert len(payload.speakers) == 0
    assert len(payload.timeline) == 0


def test_export_json_atomic_write_real_concurrency():
    """
    Kiểm thử Concurrency thực sự:
    10 writers chạy song song ghi vào CÙNG 1 file đích với các payload định danh khác nhau.
    Xác nhận:
    1. Không có exception nào xảy ra.
    2. File đích luôn parse được bằng json.load (không có nội dung trộn).
    3. File đích tương ứng trọn vẹn với một writer (Last-writer-wins).
    4. Không sót lại bất kỳ file .tmp nào trong thư mục đích.
    """
    test_dir = tempfile.mkdtemp(prefix="test_json_real_concurrency_")
    try:
        service = SpeakerLabelingService()
        dest_file = os.path.join(test_dir, "concurrent_output.json")
        errors = []

        def concurrent_writer(thread_idx: int):
            try:
                payload = DiarizationExportPayload(
                    job_id=f"JOB-THREAD-{thread_idx}",
                    audio_file=f"audio_{thread_idx}.wav",
                    status="SUCCESS",
                    audio_duration_seconds=10.0,
                    speech_duration_seconds=5.0,
                    speech_ratio=0.5,
                    total_speakers=1,
                    embeddings_status="COMPLETED"
                )
                service.export_to_json_file(payload, dest_file)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=concurrent_writer, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0, f"Có lỗi xảy ra khi ghi đồng thời: {errors}"
        assert os.path.exists(dest_file)

        with open(dest_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        assert data["status"] == "SUCCESS"
        assert data["job_id"].startswith("JOB-THREAD-")

        # Kiểm tra không còn file .tmp nào sót lại
        tmp_files = list(Path(test_dir).glob("*.tmp"))
        assert len(tmp_files) == 0, f"Còn file tạm chưa được dọn dẹp: {tmp_files}"

    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def test_json_export_error_handling_mocked():
    """Kiểm chứng xử lý lỗi IO bằng mock deterministic, không phụ thuộc hệ điều hành."""
    service = SpeakerLabelingService()
    payload = DiarizationExportPayload(
        audio_file="test.wav",
        status="SUCCESS",
        audio_duration_seconds=5.0,
        speech_duration_seconds=2.0,
        speech_ratio=0.4,
        total_speakers=1
    )

    with patch("tempfile.NamedTemporaryFile", side_effect=IOError("Simulated Disk IO Error")):
        try:
            service.export_to_json_file(payload, "/tmp/mock_test/out.json")
            assert False, "Phải ném IOError khi gặp sự cố đĩa"
        except IOError as err:
            assert "Không thể lưu file JSON" in str(err)


def test_full_pipeline_process_and_export_with_auto_embeddings():
    test_dir = tempfile.mkdtemp(prefix="test_full_auto_emb_")
    try:
        service = SpeakerLabelingService()
        out_json = os.path.join(test_dir, "result.json")

        mock_seg_res = SpeakerSegmentationResponse(
            job_id="JOB-AUTO-EMB",
            status="SUCCESS",
            audio_duration_seconds=8.0,
            speech_duration_seconds=4.0,
            speech_ratio=0.5,
            total_segments=2,
            unique_speakers=["SPEAKER_00", "SPEAKER_01"],
            segments=[
                create_dummy_segment(1, "SPEAKER_00", 0.0, 2.5),
                create_dummy_segment(2, "SPEAKER_01", 3.0, 5.0)
            ]
        )

        mock_embeddings = {
            "SPEAKER_00": [0.1] * 256,
            "SPEAKER_01": [0.2] * 256
        }

        with patch("app.services.speaker_labeling_service.speaker_diarization_service.segment_speech", return_value=mock_seg_res), \
             patch("app.services.speaker_labeling_service.diarization_runtime.extract_speaker_embeddings", return_value=mock_embeddings):

            payload, saved_path = service.process_and_export(
                audio_path="dummy_audio.wav",
                output_json_path=out_json,
                job_id="JOB-AUTO-EMB"
            )

            assert payload.status == "SUCCESS"
            assert payload.total_speakers == 2
            assert payload.embeddings_status == "COMPLETED"
            assert payload.speakers[0].embedding == [0.1] * 256
            assert payload.speakers[1].embedding == [0.2] * 256
            assert saved_path is not None and Path(saved_path).exists()
    finally:
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)


def run_all_labeling_tests():
    test_single_speaker_labeling()
    test_multi_speaker_timeline_order()
    test_speaker_label_consistency()
    test_speaker_embeddings_integration_and_status()
    test_hierarchical_speaker_segment_structure()
    test_timeline_chronological_ordering_and_label_assignment()
    test_no_speech_detected_export()
    test_export_json_atomic_write_real_concurrency()
    test_json_export_error_handling_mocked()
    test_full_pipeline_process_and_export_with_auto_embeddings()


if __name__ == "__main__":
    run_all_labeling_tests()
    print("ALL_SPEAKER_LABELING_TESTS_EXECUTED_SUCCESSFULLY")
