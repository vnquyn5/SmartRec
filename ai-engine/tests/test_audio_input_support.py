import subprocess
import wave
from unittest.mock import patch

import pytest

from app.core.path_security import validate_safe_read_path
from app.services.audio_extractor import (
    AudioExtractorService,
    InvalidMediaError,
    NoAudioStreamError,
)


def _write_normalized_wav(path: str) -> None:
    with wave.open(path, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\x01\x00" * 1600)


@pytest.mark.parametrize("extension", [".mp3", ".m4a", ".mp4", ".mkv", ".wav", ".flac", ".ogg"])
def test_media_input_extensions_are_allowed(tmp_path, extension):
    media_path = tmp_path / f"meeting{extension}"
    media_path.write_bytes(b"media")

    assert validate_safe_read_path(media_path) == media_path.resolve()


@pytest.mark.parametrize("extension", [".mp3", ".m4a", ".mp4", ".mkv"])
def test_extractor_normalizes_supported_audio_and_video_inputs(tmp_path, extension):
    input_path = tmp_path / f"meeting{extension}"
    input_path.write_bytes(b"media")
    output_path = tmp_path / "normalized.wav"
    commands = []

    def fake_run(command, **kwargs):
        commands.append(command)
        if command[0] == "ffprobe":
            return subprocess.CompletedProcess(command, 0, stdout="audio\n", stderr="")
        _write_normalized_wav(command[-1])
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    with patch("app.services.audio_extractor.subprocess.run", side_effect=fake_run):
        result = AudioExtractorService().extract_and_normalize(str(input_path), str(output_path))

    assert result["status"] == "SUCCESS"
    assert result["sample_rate"] == 16000
    assert result["channels"] == 1
    assert result["duration_seconds"] == 0.1
    ffmpeg_command = next(command for command in commands if command[0] == "ffmpeg")
    assert "-vn" in ffmpeg_command
    assert ffmpeg_command[ffmpeg_command.index("-acodec") + 1] == "pcm_s16le"
    assert ffmpeg_command[ffmpeg_command.index("-ar") + 1] == "16000"
    assert ffmpeg_command[ffmpeg_command.index("-ac") + 1] == "1"
    with wave.open(str(output_path), "rb") as wav_file:
        assert wav_file.getsampwidth() == 2


def test_video_without_audio_stream_is_terminal_input_error(tmp_path):
    input_path = tmp_path / "silent.mp4"
    input_path.write_bytes(b"video")

    with patch(
        "app.services.audio_extractor.subprocess.run",
        return_value=subprocess.CompletedProcess(["ffprobe"], 0, stdout="", stderr=""),
    ):
        with pytest.raises(NoAudioStreamError) as error:
            AudioExtractorService().extract_and_normalize(str(input_path), str(tmp_path / "out.wav"))

    assert error.value.error_code == "INVALID_AUDIO"


@pytest.mark.parametrize("stderr", ["moov atom not found", "Invalid data found when processing input"])
def test_corrupt_media_is_classified_as_deterministic(tmp_path, stderr):
    input_path = tmp_path / "corrupt.mp4"
    input_path.write_bytes(b"corrupt")
    probe_result = subprocess.CompletedProcess(["ffprobe"], 1, stdout="", stderr=stderr)

    with patch("app.services.audio_extractor.subprocess.run", return_value=probe_result):
        with pytest.raises(InvalidMediaError):
            AudioExtractorService().extract_and_normalize(str(input_path), str(tmp_path / "out.wav"))


def test_ffprobe_timeout_remains_transient(tmp_path):
    input_path = tmp_path / "meeting.mp4"
    input_path.write_bytes(b"media")
    timeout = subprocess.TimeoutExpired(cmd="ffprobe", timeout=30)

    with patch("app.services.audio_extractor.subprocess.run", side_effect=timeout):
        with pytest.raises(subprocess.TimeoutExpired):
            AudioExtractorService().extract_and_normalize(str(input_path), str(tmp_path / "out.wav"))
