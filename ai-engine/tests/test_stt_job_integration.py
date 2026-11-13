from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.services.stt_job_integration import run_stt_for_job


def whisper_segment(start, end, text):
    return SimpleNamespace(
        start=start,
        end=end,
        text=text,
    )


def diarization_segments():
    return [
        {
            "speakerLabel": "SPEAKER_00",
            "startTime": 0.0,
            "endTime": 2.5,
        },
        {
            "speakerLabel": "SPEAKER_01",
            "startTime": 3.0,
            "endTime": 5.0,
        },
    ]


def run_with_mocked_whisper(segments, callback, diarization=None, checkpoint=None, execution_id=None, timeline_mode="raw"):
    meeting_id = uuid4()
    job_id = uuid4()

    with patch(
        "app.services.stt_job_integration.WhisperASRService"
    ) as factory:
        whisper = factory.return_value.__enter__.return_value
        whisper.transcribe.return_value = {
            "language": "vi",
            "segments": segments,
        }

        result = run_stt_for_job(
            audio_path="/mock/clean.wav",
            formatted_segments=(
                diarization
                if diarization is not None
                else diarization_segments()
            ),
            meeting_id=str(meeting_id),
            job_id=str(job_id),
            callback_client=callback,
            backend_base_url="http://localhost:8082/api/v1",
            internal_token="test-token",
            checkpoint=checkpoint,
            execution_id=execution_id,
            timeline_mode=timeline_mode,
        )

    return result, meeting_id, job_id


@pytest.mark.parametrize("stop_at", [1, 2, 3])
def test_control_boundary_stops_before_transcript_publication(stop_at):
    class ControlStopped(Exception):
        pass

    callback = MagicMock()
    checkpoints = MagicMock(side_effect=[None] * (stop_at - 1) + [ControlStopped()])
    with pytest.raises(ControlStopped):
        run_with_mocked_whisper(
            [whisper_segment(0.5, 1.5, "Kiểm tra lease.")], callback,
            checkpoint=checkpoints,
        )
    callback.send_stt_result.assert_not_called()


def test_control_boundary_after_delivery_prevents_downstream_success():
    callback = MagicMock()
    callback.send_stt_result.return_value = True
    checkpoint = MagicMock(side_effect=[None, None, None, RuntimeError("lease lost")])
    with pytest.raises(RuntimeError, match="lease lost"):
        run_with_mocked_whisper(
            [whisper_segment(0.5, 1.5, "Đã lưu transcript.")], callback,
            checkpoint=checkpoint,
        )
    callback.send_stt_result.assert_called_once()


def test_invalid_job_id_is_rejected_before_model_loading():
    with patch("app.services.stt_job_integration.WhisperASRService") as factory:
        with pytest.raises(ValueError):
            run_stt_for_job(
                audio_path="/mock/clean.wav", formatted_segments=diarization_segments(),
                meeting_id=str(uuid4()), job_id="not-a-uuid", callback_client=MagicMock(),
                backend_base_url="http://localhost:8082/api/v1", internal_token="test-token",
            )
    factory.assert_not_called()


@pytest.mark.parametrize("http_status", [200, 503])
def test_stt_integration_uses_real_callback_client_with_mock_http(http_status):
    from app.services.callback_client import CallbackClient

    client = CallbackClient(max_retries=1)
    with patch("app.services.callback_client.requests.post",
               return_value=SimpleNamespace(status_code=http_status)) as post:
        if http_status == 200:
            payload, meeting_id, job_id = run_with_mocked_whisper(
                [whisper_segment(0.25, 1.5, "Tích hợp callback.")], client)
            assert payload["meetingId"] == str(meeting_id)
            assert payload["processingJobId"] == str(job_id)
        else:
            with pytest.raises(RuntimeError, match="STT_CALLBACK_DELIVERY_FAILED"):
                run_with_mocked_whisper(
                    [whisper_segment(0.25, 1.5, "Tích hợp callback.")], client)
    post.assert_called_once()
    assert post.call_args.args[0] == "http://localhost:8082/api/v1/internal/stt/callback"
    sent = post.call_args.kwargs["json"]["segments"][0]
    assert sent["speakerLabel"] == "SPEAKER_00"
    assert sent["startTimeMs"] == 250
    assert "speakerId" not in sent


def test_stt_delivers_transcript_with_correct_speaker_labels():
    callback = MagicMock()
    callback.send_stt_result.return_value = True

    payload, meeting_id, job_id = run_with_mocked_whisper(
        [
            whisper_segment(0.25, 2.0, "Bắt đầu cuộc họp."),
            whisper_segment(3.25, 4.5, "Hoàn thiện API."),
        ],
        callback,
    )

    assert payload["meetingId"] == str(meeting_id)
    assert payload["processingJobId"] == str(job_id)

    assert payload["segments"][0]["speakerLabel"] == "SPEAKER_00"
    assert payload["segments"][1]["speakerLabel"] == "SPEAKER_01"

    assert payload["segments"][0]["startTimeMs"] == 250
    assert payload["segments"][1]["endTimeMs"] == 4500

    assert all(
        "speakerId" not in item
        for item in payload["segments"]
    )

    callback.send_stt_result.assert_called_once_with(
        "http://localhost:8082/api/v1",
        payload,
        internal_token="test-token",
    )


def test_stt_marks_unresolved_speaker_without_inventing_identity():
    callback = MagicMock()
    payload, _, _ = run_with_mocked_whisper([whisper_segment(8.0, 9.0, "Không có speaker.")], callback)
    assert payload["segments"][0]["attributionStatus"] == "UNRESOLVED"
    assert "speakerLabel" not in payload["segments"][0]
    callback.send_stt_result.assert_called_once()


def test_stt_rejects_empty_transcript():
    callback = MagicMock()

    with pytest.raises(ValueError, match="STT_EMPTY_TRANSCRIPT"):
        run_with_mocked_whisper([], callback)

    callback.send_stt_result.assert_not_called()


def test_stt_fails_if_backend_does_not_accept_callback():
    callback = MagicMock()
    callback.send_stt_result.return_value = False

    with pytest.raises(
        RuntimeError,
        match="STT_CALLBACK_DELIVERY_FAILED",
    ):
        run_with_mocked_whisper(
            [whisper_segment(0.5, 1.5, "Kiểm tra callback.")],
            callback,
        )

    callback.send_stt_result.assert_called_once()


def test_stt_rejects_invalid_diarization_timestamps():
    callback = MagicMock()

    with pytest.raises(ValueError, match="Invalid diarization timestamps"):
        run_with_mocked_whisper(
            [whisper_segment(0.0, 1.0, "Test.")],
            callback,
            diarization=[
                {
                    "speakerLabel": "SPEAKER_00",
                    "startTime": 2.0,
                    "endTime": 1.0,
                }
            ],
        )

    callback.send_stt_result.assert_not_called()


def test_stt_integration_forwards_execution_fence():
    callback = MagicMock()
    run_with_mocked_whisper([whisper_segment(0.5, 1.5, "Transcript")], callback, execution_id="execution-1")
    assert callback.send_stt_result.call_args.kwargs["execution_id"] == "execution-1"


def test_cross_speaker_boundary_keeps_whisper_bounds_and_marks_identity_ambiguous():
    meeting_id, job_id = str(uuid4()), str(uuid4())
    callback = MagicMock()
    callback.send_stt_result.return_value = True
    crossing_timeline = [
        {"speakerLabel": "SPEAKER_02", "startTime": 12.62, "endTime": 18.037},
        {"speakerLabel": "SPEAKER_03", "startTime": 18.037, "endTime": 22.002},
    ]
    with patch("app.services.stt_job_integration.WhisperASRService") as factory:
        factory.return_value.__enter__.return_value.transcribe.return_value = {
            "language": "vi", "segments": [whisper_segment(17.5, 19.0, "Một câu qua ranh giới.")],
        }
        payload = run_stt_for_job(
            audio_path="audio.wav", formatted_segments=crossing_timeline,
            meeting_id=meeting_id, job_id=job_id, callback_client=callback,
            backend_base_url="http://localhost:8082/api/v1", internal_token="test-token",
        )
    assert len(payload["segments"]) == 1
    segment = payload["segments"][0]
    assert (segment["startTimeMs"], segment["endTimeMs"]) == (17500, 19000)
    assert segment["text"] == "Một câu qua ranh giới."
    assert segment["attributionStatus"] == "CROSS_SPEAKER_BOUNDARY"
    assert "speakerLabel" not in segment and "speakerId" not in segment
    callback.send_stt_result.assert_called_once()


def test_reliable_word_times_split_cross_boundary_text_without_inventing_timestamps():
    meeting_id, job_id = str(uuid4()), str(uuid4())
    callback = MagicMock()
    callback.send_stt_result.return_value = True
    segment = SimpleNamespace(
        start=0.0, end=2.0, text="Hello world",
        words=[SimpleNamespace(start=0.2, end=0.8, word="Hello "),
               SimpleNamespace(start=1.2, end=1.8, word="world")],
    )
    timeline = [
        {"speakerLabel": "SPEAKER_A", "startTime": 0.0, "endTime": 1.0},
        {"speakerLabel": "SPEAKER_B", "startTime": 1.0, "endTime": 2.0},
    ]
    with patch("app.services.stt_job_integration.WhisperASRService") as factory:
        factory.return_value.__enter__.return_value.transcribe.return_value = {
            "language": "en", "segments": [segment],
        }
        payload = run_stt_for_job(
            audio_path="audio.wav", formatted_segments=timeline,
            meeting_id=meeting_id, job_id=job_id, callback_client=callback,
            backend_base_url="http://localhost:8082/api/v1", internal_token="test-token",
        )
    assert [(item["startTimeMs"], item["endTimeMs"], item["text"], item["speakerLabel"])
            for item in payload["segments"]] == [
        (200, 800, "Hello", "SPEAKER_A"), (1200, 1800, "world", "SPEAKER_B"),
    ]


def test_verified_stt_checkpoint_reuses_payload_after_ocr_retry(tmp_path, monkeypatch):
    from uuid import uuid4

    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(tmp_path))
    meeting_id, job_id = str(uuid4()), str(uuid4())
    job_dir = tmp_path / job_id
    job_dir.mkdir()
    audio = job_dir / "02_cleaned.wav"
    audio.write_bytes(b"verified normalized audio")
    checkpoint_path = job_dir / "04_stt_result.json"
    callback = MagicMock()
    callback.send_stt_result.return_value = True
    kwargs = dict(
        audio_path=str(audio), formatted_segments=diarization_segments(),
        meeting_id=meeting_id, job_id=job_id, callback_client=callback,
        backend_base_url="http://localhost:8082/api/v1", internal_token="test-token",
        checkpoint_path=checkpoint_path,
    )
    with patch("app.services.stt_job_integration.WhisperASRService") as factory:
        factory.return_value.__enter__.return_value.transcribe.return_value = {
            "language": "vi", "segments": [whisper_segment(.5, 1.5, "Đã nhận dạng.")],
        }
        first = run_stt_for_job(**kwargs)
        factory.return_value.__enter__.return_value.transcribe.assert_called_once()
    with patch("app.services.stt_job_integration.WhisperASRService") as retry_factory:
        second = run_stt_for_job(**kwargs)
        retry_factory.assert_not_called()
    assert second == first
    assert callback.send_stt_result.call_count == 2
    assert checkpoint_path.is_file()


def test_stt_checkpoint_is_not_reused_after_audio_changes(tmp_path, monkeypatch):
    from uuid import uuid4

    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(tmp_path))
    meeting_id, job_id = str(uuid4()), str(uuid4())
    job_dir = tmp_path / job_id
    job_dir.mkdir()
    audio = job_dir / "02_cleaned.wav"
    audio.write_bytes(b"first audio")
    checkpoint_path = job_dir / "04_stt_result.json"
    callback = MagicMock()
    callback.send_stt_result.return_value = True
    kwargs = dict(audio_path=str(audio), formatted_segments=diarization_segments(),
                  meeting_id=meeting_id, job_id=job_id, callback_client=callback,
                  backend_base_url="http://localhost:8082/api/v1", internal_token="test-token",
                  checkpoint_path=checkpoint_path)
    with patch("app.services.stt_job_integration.WhisperASRService") as first_factory:
        first_factory.return_value.__enter__.return_value.transcribe.return_value = {
            "language": "vi", "segments": [whisper_segment(.5, 1.5, "Lần một.")],
        }
        run_stt_for_job(**kwargs)
    audio.write_bytes(b"different audio")
    with patch("app.services.stt_job_integration.WhisperASRService") as retry_factory:
        retry_factory.return_value.__enter__.return_value.transcribe.return_value = {
            "language": "vi", "segments": [whisper_segment(.5, 1.5, "Lần hai.")],
        }
        payload = run_stt_for_job(**kwargs)
        retry_factory.return_value.__enter__.return_value.transcribe.assert_called_once()
    assert payload["segments"][0]["text"] == "Lần hai."


def test_stt_checkpoint_mode_change_realigns_verified_transcript_without_whisper(tmp_path, monkeypatch):
    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(tmp_path))
    meeting_id, job_id = str(uuid4()), str(uuid4())
    job_dir = tmp_path / job_id
    job_dir.mkdir()
    audio = job_dir / "02_cleaned.wav"
    audio.write_bytes(b"verified normalized audio")
    checkpoint_path = job_dir / "04_stt_result.json"
    callback = MagicMock()
    callback.send_stt_result.return_value = True
    common = dict(
        audio_path=str(audio), meeting_id=meeting_id, job_id=job_id,
        callback_client=callback, backend_base_url="http://localhost:8082/api/v1",
        internal_token="test-token", checkpoint_path=checkpoint_path,
    )
    raw_timeline = [
        {"speakerLabel": "SPEAKER_A", "startTime": 0.0, "endTime": 2.5},
    ]
    with patch("app.services.stt_job_integration.WhisperASRService") as first_factory:
        first_factory.return_value.__enter__.return_value.transcribe.return_value = {
            "language": "vi", "segments": [whisper_segment(.5, 1.5, "Dữ liệu đã xác minh.")],
        }
        first = run_stt_for_job(**common, formatted_segments=raw_timeline, timeline_mode="raw")
        first_factory.return_value.__enter__.return_value.transcribe.assert_called_once()

    exclusive_timeline = [
        {"speakerLabel": "SPEAKER_A", "startTime": 0.0, "endTime": .4},
        {"speakerLabel": "SPEAKER_B", "startTime": .4, "endTime": 2.5},
    ]
    with patch("app.services.stt_job_integration.WhisperASRService") as retry_factory:
        second = run_stt_for_job(
            **common, formatted_segments=exclusive_timeline, timeline_mode="exclusive",
        )
        retry_factory.assert_not_called()
    assert first["segments"][0]["speakerLabel"] == "SPEAKER_A"
    assert second["segments"][0]["speakerLabel"] == "SPEAKER_B"
    assert second["segments"][0]["text"] == first["segments"][0]["text"]
    provenance = checkpoint_path.with_suffix(".provenance.json").read_text(encoding="utf-8")
    assert '"timeline_mode": "exclusive"' in provenance


def test_stt_checkpoint_smoothing_identity_change_realigns_without_whisper(tmp_path, monkeypatch):
    monkeypatch.setenv("SMARTREC_WORKSPACE_ROOT", str(tmp_path))
    meeting_id, job_id = str(uuid4()), str(uuid4())
    job_dir = tmp_path / job_id
    job_dir.mkdir()
    audio = job_dir / "02_cleaned.wav"
    audio.write_bytes(b"verified normalized audio")
    checkpoint_path = job_dir / "04_stt_result.json"
    callback = MagicMock()
    callback.send_stt_result.return_value = True
    common = dict(audio_path=str(audio), meeting_id=meeting_id, job_id=job_id,
                  callback_client=callback, backend_base_url="http://localhost:8082/api/v1",
                  internal_token="test-token", checkpoint_path=checkpoint_path)
    with patch("app.services.stt_job_integration.WhisperASRService") as first_factory:
        first_factory.return_value.__enter__.return_value.transcribe.return_value = {
            "language": "vi", "segments": [whisper_segment(.5, 1.5, "Verified text.")],
        }
        first = run_stt_for_job(**common, formatted_segments=diarization_segments(), timeline_mode="exclusive",
                                smoothing_enabled=True, smoothing_max_fragment_ms=150)
        first_factory.return_value.__enter__.return_value.transcribe.assert_called_once()
    revised_timeline = [
        {"speakerLabel": "SPEAKER_01", "startTime": 0.0, "endTime": 2.5},
    ]
    with patch("app.services.stt_job_integration.WhisperASRService") as retry_factory:
        second = run_stt_for_job(**common, formatted_segments=revised_timeline, timeline_mode="exclusive",
                                 smoothing_enabled=True, smoothing_max_fragment_ms=100)
        retry_factory.assert_not_called()
    assert first["segments"][0]["text"] == second["segments"][0]["text"]
    assert first["segments"][0]["speakerLabel"] != second["segments"][0]["speakerLabel"]
    provenance = checkpoint_path.with_suffix(".provenance.json").read_text(encoding="utf-8")
    assert '"schema_version": "1.3"' in provenance
    assert '"smoothing_max_fragment_ms": 100' in provenance
