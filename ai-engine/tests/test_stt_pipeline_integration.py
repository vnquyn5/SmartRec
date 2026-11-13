"""Kiểm thử tích hợp STT → Speaker Alignment → Transcript JSON."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.services.whisper_asr_service import WhisperASRService
from app.services.speaker_transcript_aligner import align_speakers, analyze_speaker_attribution
from app.services.transcript_parser import build_transcript_payload


def test_stt_pipeline_to_backend_json(tmp_path):
    audio = tmp_path / "meeting.wav"
    audio.write_bytes(b"mock-audio")

    meeting_id = uuid4()
    job_id = uuid4()
    speaker_1 = uuid4()
    speaker_2 = uuid4()

    whisper_segments = [
        SimpleNamespace(
            start=0.0,
            end=2.5,
            text="Xin chào mọi người.",
            words=[
                SimpleNamespace(start=0.0, end=1.0),
                SimpleNamespace(start=1.0, end=2.5),
            ],
        ),
        SimpleNamespace(
            start=3.0,
            end=5.0,
            text="Chúng ta bắt đầu cuộc họp.",
            words=[
                SimpleNamespace(start=3.0, end=4.0),
                SimpleNamespace(start=4.0, end=5.0),
            ],
        ),
    ]

    diarization_timeline = [
        SimpleNamespace(
            start_seconds=0.0,
            end_seconds=2.7,
            raw_speaker_id="SPEAKER_00",
            speaker="Speaker 1",
        ),
        SimpleNamespace(
            start_seconds=2.8,
            end_seconds=5.5,
            raw_speaker_id="SPEAKER_01",
            speaker="Speaker 2",
        ),
    ]

    adapter = MagicMock()
    adapter.is_ready = True
    adapter.predict.return_value = (
        whisper_segments,
        SimpleNamespace(language="vi"),
    )

    with patch(
        "app.services.whisper_asr_service.create_whisper_adapter",
        return_value=adapter,
    ):
        with WhisperASRService() as service:
            stt_result = service.transcribe(str(audio))

    speaker_ids = align_speakers(
        stt_result["segments"],
        diarization_timeline,
        {
            "SPEAKER_00": speaker_1,
            "SPEAKER_01": speaker_2,
        },
    )

    payload = build_transcript_payload(
        meeting_id=meeting_id,
        processing_job_id=job_id,
        segments=stt_result["segments"],
        language=stt_result["language"],
        speaker_ids=speaker_ids,
    )

    result = payload.model_dump(mode="json")

    assert result["meetingId"] == str(meeting_id)
    assert result["processingJobId"] == str(job_id)
    assert result["success"] is True
    assert result["language"] == "vi"
    assert result["modelName"] == "whisper"

    assert result["segments"] == [
        {
            "speakerId": str(speaker_1),
            "startTimeMs": 0,
            "endTimeMs": 2500,
            "text": "Xin chào mọi người.",
        },
        {
            "speakerId": str(speaker_2),
            "startTimeMs": 3000,
            "endTimeMs": 5000,
            "text": "Chúng ta bắt đầu cuộc họp.",
        },
    ]

    adapter.load_model.assert_called_once()
    adapter.predict.assert_called_once_with(
        str(audio),
        language="vi",
        beam_size=5,
        word_timestamps=True,
    )
    adapter.unload.assert_called_once()


def test_speaker_alignment_uses_text_bearing_word_boundaries_when_segment_crosses_turn():
    """Reliable word timing can split crossing text without stretching either speaker interval."""
    whisper_segment = SimpleNamespace(
        start=0.0,
        end=10.0,
        text="Nội dung cuộc họp.",
        words=[
            SimpleNamespace(start=8.0, end=9.0, word="Nội dung "),
            SimpleNamespace(start=9.0, end=10.0, word="cuộc họp."),
        ],
    )

    diarization_timeline = [
        SimpleNamespace(
            start_seconds=0.0,
            end_seconds=8.0,
            raw_speaker_id="SPEAKER_00",
            speaker="Speaker A",
        ),
        SimpleNamespace(
            start_seconds=8.0,
            end_seconds=10.0,
            raw_speaker_id="SPEAKER_01",
            speaker="Speaker B",
        ),
    ]

    attribution = analyze_speaker_attribution([whisper_segment], diarization_timeline)[0]
    assert attribution.status == "WORD_LEVEL_SPLIT"
    assert attribution.word_assignments == (
        (8.0, 9.0, "Nội dung ", "SPEAKER_01"),
        (9.0, 10.0, "cuộc họp.", "SPEAKER_01"),
    )
