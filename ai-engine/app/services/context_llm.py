"""Rule-based context packing and bounded Ollama extraction."""

import json
import os
import re
from typing import Any, Literal

import requests
from pydantic import BaseModel, ConfigDict, Field, ValidationError


class TaskItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    description: str = Field(min_length=1)
    assignee: str | None = None
    deadline: str | None = None
    source_start_ms: int = Field(ge=0, alias="sourceStartTimeMs")
    source_text: str = Field(min_length=1, alias="sourceText")
    speaker_label: str | None = Field(default=None, alias="speakerLabel")
    confidence: Literal["supported", "verify"] = "verify"


class ChunkExtraction(BaseModel):
    summary: str = ""
    key_decisions: list[str] = Field(default_factory=list)
    tasks: list[TaskItem] = Field(default_factory=list)


class MeetingExtraction(BaseModel):
    summary: str = ""
    key_decisions: list[str] = Field(default_factory=list)
    tasks: list[TaskItem] = Field(default_factory=list)


DECISION_TASK = re.compile(
    r"\b(decid(?:e|ed|ing)|agreed|action item|assigned|will (?:do|send|prepare|finish|deliver)|"
    r"task|deadline|by\s+(?:monday|tuesday|wednesday|thursday|friday|\d)|"
    r"quyết định|thống nhất|giao (?:cho|việc)|phụ trách|chịu trách nhiệm|"
    r"sẽ (?:làm|gửi|chuẩn bị|hoàn thành|nộp)|hãy (?:làm|gửi|chuẩn bị|hoàn thành)|"
    r"nhiệm vụ|hạn chót|hạn hoàn thành)\b", re.I
)
RAW_DEADLINE = re.compile(
    r"\b(?:thứ\s+(?:hai|ba|tư|năm|sáu|bảy)|chủ\s+nhật|monday|tuesday|wednesday|"
    r"thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b", re.I
)
HAN_SCRIPT = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")


def build_context_chunks(transcript: list[dict[str, Any]], ocr: list[dict[str, Any]], max_words: int = 650) -> list[dict[str, Any]]:
    events = []
    for item in transcript:
        start = int(item.get("startTimeMs", 0))
        events.append({"kind": "speech", "startTimeMs": start, "endTimeMs": int(item.get("endTimeMs", start)),
                       "speakerLabel": item.get("speakerLabel"), "text": str(item.get("text", ""))})
    for item in ocr:
        stamp = int(item.get("timestampMs", 0))
        events.append({"kind": "slide", "startTimeMs": stamp, "endTimeMs": stamp, "text": str(item.get("text", ""))})
    events.sort(key=lambda event: (event["startTimeMs"], event["kind"]))
    chunks, current, words = [], [], 0
    for event in events:
        count = max(1, len(event["text"].split()))
        protected = bool(DECISION_TASK.search(event["text"]))
        if current and words + count > max_words and not protected:
            chunks.append({"chunkIndex": len(chunks), "startTimeMs": current[0]["startTimeMs"],
                           "endTimeMs": current[-1]["endTimeMs"], "events": current})
            current, words = [], 0
        current.append(event)
        words += count
    if current:
        chunks.append({"chunkIndex": len(chunks), "startTimeMs": current[0]["startTimeMs"],
                       "endTimeMs": current[-1]["endTimeMs"], "events": current})
    return chunks


class OllamaMeetingClient:
    def __init__(self, base_url: str | None = None, model: str | None = None, timeout: int | None = None):
        self.base_url = (base_url or os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")).rstrip("/")
        self.model = model or os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b")
        self.timeout = timeout or int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "900"))
        self.num_ctx = int(os.getenv("OLLAMA_NUM_CTX", "3072"))

    def _extract(self, events: list[dict[str, Any]]) -> ChunkExtraction:
        prompt = (
            "Extract only supported facts from this meeting chunk. Never infer an assignee or deadline. "
            "Write task descriptions in Vietnamese. Do not turn project goals into tasks unless a concrete action is assigned or committed. "
            "For every task include exact sourceText and sourceStartTimeMs from the same speech event, plus speakerLabel when present. "
            "Copy deadline wording verbatim from sourceText; never invent or normalize a date. Use confidence='verify' when evidence is incomplete. Return JSON only.\n" + json.dumps(events, ensure_ascii=False)
        )
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                response = requests.post(
                    f"{self.base_url}/api/chat",
                    json={"model": self.model, "stream": False, "format": ChunkExtraction.model_json_schema(),
                          "messages": [{"role": "system", "content": prompt}],
                          "options": {"temperature": 0, "num_ctx": self.num_ctx},
                          "keep_alive": "0"},
                    timeout=self.timeout,
                )
                response.raise_for_status()
                result = ChunkExtraction.model_validate_json(response.json()["message"]["content"])
                source_by_time = {
                    int(event["startTimeMs"]): event for event in events
                    if event.get("kind") == "speech" and event.get("text")
                }
                grounded_tasks = []
                for task in result.tasks:
                    source = source_by_time.get(task.source_start_ms)
                    if source is None:
                        continue
                    source_text = source["text"].casefold()
                    # A model can turn a speaker's goal or description into an
                    # action item. Keep tasks only when the exact source event
                    # contains an explicit decision, assignment, deadline, or
                    # task signal.
                    if not DECISION_TASK.search(source_text):
                        continue
                    # source_text is always attached from the exact event selected by
                    # the model's timestamp; never trust a model-generated quotation.
                    assignee = task.assignee if task.assignee and task.assignee.casefold() in source_text else None
                    raw_deadline = RAW_DEADLINE.search(source["text"])
                    deadline = raw_deadline.group(0) if raw_deadline else None
                    # A model-supplied date without a verbatim source span is unverified.
                    deadline_unverified = bool(task.deadline and not raw_deadline)
                    grounded_tasks.append(task.model_copy(update={
                        "assignee": assignee,
                        "deadline": deadline,
                        "source_text": source["text"],
                        "speaker_label": source.get("speakerLabel"),
                        "confidence": "verify" if (
                            deadline_unverified or HAN_SCRIPT.search(task.description)
                            or assignee != task.assignee or deadline != task.deadline
                        ) else task.confidence,
                    }))
                result.tasks = grounded_tasks
                return result
            except (requests.RequestException, KeyError, ValueError, ValidationError) as exc:
                last_error = exc
        raise RuntimeError(f"Ollama extraction failed after retry: {last_error}") from last_error

    def analyze(self, chunks: list[dict[str, Any]]) -> MeetingExtraction:
        extractions = [self._extract(chunk["events"]) for chunk in chunks]
        tasks: dict[tuple[int, str], TaskItem] = {}
        decisions = []
        summaries = []
        for result in extractions:
            summaries.extend([part for part in result.summary.splitlines() if part.strip()])
            decisions.extend(result.key_decisions)
            for task in result.tasks:
                tasks[(task.source_start_ms, task.description.casefold())] = task
        # Deterministic map reduction avoids sending long source transcript back into a second LLM call.
        return MeetingExtraction(
            summary="\n".join(dict.fromkeys(summaries)),
            key_decisions=list(dict.fromkeys(decisions)),
            tasks=list(tasks.values()),
        )
