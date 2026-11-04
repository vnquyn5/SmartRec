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


def run_with_mocked_whisper(segments, callback, diarization=None, checkpoint=None, execution_id=None):
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


def test_stt_rejects_unresolved_speaker():
    callback = MagicMock()

    with pytest.raises(ValueError, match="STT_SPEAKER_UNRESOLVED"):
        run_with_mocked_whisper(
            [whisper_segment(8.0, 9.0, "Không có speaker.")],
            callback,
        )

    callback.send_stt_result.assert_not_called()


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
