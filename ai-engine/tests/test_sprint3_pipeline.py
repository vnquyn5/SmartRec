import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.context_llm import OllamaMeetingClient, build_context_chunks
from app.services.speaker_transcript_aligner import align_speakers
from app.services.video_ocr import extract_video_ocr
from app.services.whisper_asr_service import WhisperASRService
from app.adapters.whisper_adapter import WhisperCppHttpAdapter


def test_context_chunks_keep_timestamps_speakers_and_decision_events():
    transcript = [
        {"startTimeMs": 1000, "endTimeMs": 2000, "speakerLabel": "Speaker 1", "text": "Discussion"},
        {"startTimeMs": 3000, "endTimeMs": 4000, "speakerLabel": "Speaker 2", "text": "We decided the deadline is Friday"},
    ]
    chunks = build_context_chunks(transcript, [{"timestampMs": 2500, "text": "Roadmap"}], max_words=2)
    flat = [event for chunk in chunks for event in chunk["events"]]
    assert [event["startTimeMs"] for event in flat] == [1000, 2500, 3000]
    assert next(event for event in flat if event["kind"] == "speech")["speakerLabel"] == "Speaker 1"
    assert any("decided" in event["text"] for event in flat)


def test_speaker_alignment_leaves_ties_unassigned():
    transcript = [SimpleNamespace(start=0.0, end=2.0), SimpleNamespace(start=0.0, end=1.0)]
    diar = [
        SimpleNamespace(start_seconds=0.0, end_seconds=1.0, raw_speaker_id="a", speaker="Speaker 1"),
        SimpleNamespace(start_seconds=1.0, end_seconds=2.0, raw_speaker_id="b", speaker="Speaker 2"),
    ]
    aligned = align_speakers(transcript, diar, {"a": "Speaker 1", "b": "Speaker 2"})
    assert aligned == {0: None, 1: "Speaker 1"}


def test_whisper_cpp_response_parsing_and_asr_contract(tmp_path, monkeypatch):
    monkeypatch.setenv("STT_PROVIDER", "whisper_cpp")
    audio = tmp_path / "clean.wav"
    audio.write_bytes(b"wav")
    response = MagicMock()
    response.json.return_value = {"language": "vi", "transcription": [{
        "timestamps": {"from": "00:00:01,250", "to": "00:00:02,500"}, "text": " Xin chào ",
    }]}
    with patch("app.adapters.whisper_adapter.requests.post", return_value=response) as post:
        with WhisperASRService(beam_size=1) as asr:
            result = asr.transcribe(str(audio))
    assert isinstance(asr._adapter, WhisperCppHttpAdapter)
    assert result["segments"][0].start == 1.25
    assert result["segments"][0].end == 2.5
    assert result["segments"][0].text == "Xin chào"
    post.assert_called_once()


def test_ollama_json_schema_response_is_validated():
    response = MagicMock()
    response.json.return_value = {"message": {"content": json.dumps({
        "summary": "Plan",
        "key_decisions": ["Launch in June"],
        "tasks": [{"description": "Chuẩn bị kế hoạch", "assignee": "Minh", "deadline": "Friday",
                    "source_start_ms": 1234, "source_text": "fabricated quote",
                    "speaker_label": "Speaker 99", "confidence": "supported"}],
    })}}
    with patch("app.services.context_llm.requests.post", return_value=response) as post:
        result = OllamaMeetingClient().analyze([{"events": [{"kind": "speech", "startTimeMs": 1234,
                                                              "text": "We decided the plan by Friday"}]}])
    assert result.tasks[0].source_start_ms == 1234
    assert result.tasks[0].assignee is None
    assert result.tasks[0].deadline == "Friday"
    assert result.tasks[0].confidence == "verify"
    assert result.tasks[0].source_text == "We decided the plan by Friday"
    post.assert_called_once()
    assert post.call_args.kwargs["json"]["options"]["temperature"] == 0


def test_ollama_drops_tasks_without_explicit_source_signal():
    response = MagicMock()
    response.json.return_value = {"message": {"content": json.dumps({
        "summary": "A goal",
        "tasks": [{"description": "Chuẩn bị kế hoạch", "source_start_ms": 1234,
                    "source_text": "Mục tiêu của dự án là cải thiện chất lượng phần mềm"}],
    })}}
    with patch("app.services.context_llm.requests.post", return_value=response):
        result = OllamaMeetingClient().analyze([{"events": [{
            "kind": "speech", "startTimeMs": 1234, "text": "Mục tiêu của dự án là cải thiện chất lượng phần mềm"}]}])
    assert result.tasks == []


def test_ollama_preserves_vietnamese_deadline_and_exact_source_link():
    source = "Lan sẽ chuẩn bị báo cáo trước thứ Sáu."
    response = MagicMock()
    response.json.return_value = {"message": {"content": json.dumps({
        "tasks": [{"description": "Lan chuẩn bị báo cáo", "assignee": "Lan",
                    "deadline": "2026-10-30", "source_start_ms": 4321,
                    "source_text": "Lan submits by Friday", "confidence": "supported"}],
    }, ensure_ascii=False)}}
    with patch("app.services.context_llm.requests.post", return_value=response):
        result = OllamaMeetingClient().analyze([{"events": [{
            "kind": "speech", "startTimeMs": 4321, "speakerLabel": "Speaker 1", "text": source,
        }]}])
    task = result.tasks[0]
    assert task.deadline == "thứ Sáu"
    assert task.source_text == source
    assert task.source_start_ms == 4321
    assert task.speaker_label == "Speaker 1"
    assert task.confidence == "verify"


def test_ollama_marks_chinese_description_for_review():
    response = MagicMock()
    response.json.return_value = {"message": {"content": json.dumps({
        "tasks": [{"description": "准备项目报告", "source_start_ms": 99,
                    "source_text": "Hãy chuẩn bị báo cáo dự án"}],
    }, ensure_ascii=False)}}
    with patch("app.services.context_llm.requests.post", return_value=response):
        result = OllamaMeetingClient().analyze([{"events": [{
            "kind": "speech", "startTimeMs": 99, "text": "Hãy chuẩn bị báo cáo dự án",
        }]}])
    assert result.tasks[0].confidence == "verify"


def test_ollama_rejects_task_missing_required_source_text():
    response = MagicMock()
    response.json.return_value = {"message": {"content": json.dumps({
        "tasks": [{"description": "Chuẩn bị báo cáo", "source_start_ms": 99}],
    })}}
    with patch("app.services.context_llm.requests.post", return_value=response):
        try:
            OllamaMeetingClient().analyze([{"events": [{
                "kind": "speech", "startTimeMs": 99, "text": "Hãy chuẩn bị báo cáo",
            }]}])
        except RuntimeError:
            pass
        else:
            raise AssertionError("Missing required source_text must not be accepted")


def test_ocr_samples_keyframes_and_deduplicates_text(tmp_path):
    def run(command, **kwargs):
        if command[0] == "ffmpeg":
            (tmp_path / "ocr_frames" / "frame-0001.jpg").write_bytes(b"1")
            (tmp_path / "ocr_frames" / "frame-0002.jpg").write_bytes(b"2")
            return SimpleNamespace(returncode=0, stderr="", stdout="")
        return SimpleNamespace(returncode=0, stderr="", stdout="Title: roadmap")

    with patch("app.services.video_ocr.subprocess.run", side_effect=run):
        output = extract_video_ocr("clip.mp4", str(tmp_path))
    assert len(output) == 1
    assert output[0]["timestampMs"] == 0
    assert output[0]["text"] == "Title: roadmap"
