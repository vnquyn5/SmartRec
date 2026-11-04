"""Manual E2E smoke check for the internal LLM routes and local Ollama."""

from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import internal_llm_routes
from app.core.config import settings
from app.services.local_llm_client import LocalLLMClient


TOKEN = "manual-local-llm-test-token"
MEETING_ID = str(uuid4())
JOB_ID = str(uuid4())
REQUEST_ID = str(uuid4())
SOURCE_ID = str(uuid4())
SOURCE_REF = f"TRANSCRIPT:{SOURCE_ID}"
TRANSCRIPT = (
    "Nhóm đã thống nhất sử dụng PostgreSQL cho SmartRec. "
    "Minh được giao kiểm thử API trước thứ Sáu."
)

# Exercise the same FastAPI handlers used in production without importing the
# audio application startup (the model call still goes to configured Ollama).
settings.smartrec_internal_token = TOKEN
app = FastAPI()


class RecordingLocalClient(LocalLLMClient):
    attempts = 0

    def generate(self, **kwargs):
        self.attempts += 1
        return super().generate(**kwargs)


ollama_client = RecordingLocalClient()
internal_llm_routes.local_llm_client = ollama_client
app.include_router(internal_llm_routes.router, prefix="/api/v1")
client = TestClient(app)
headers = {"X-Internal-Token": TOKEN}
base = {
    "contractVersion": "smartrec.local-llm.v1",
    "requestId": REQUEST_ID,
    "jobId": JOB_ID,
    "meetingId": MEETING_ID,
    "taskType": "MEETING_ANALYSIS",
}

prepared = client.post(
    "/api/v1/internal/llm/prepare",
    headers=headers,
    json={
        **base,
        "evidence": [{
            "sourceType": "TRANSCRIPT",
            "sourceId": SOURCE_ID,
            "speakerId": None,
            "startTimeMs": 0,
            "endTimeMs": 2000,
            "text": TRANSCRIPT,
        }],
    },
)
assert prepared.status_code == 200, prepared.text
prepared_body = prepared.json()

generated = client.post(
    "/api/v1/internal/llm/generate",
    headers=headers,
    json={
        **base,
        "systemPrompt": prepared_body["systemPrompt"],
        "prompt": prepared_body["prompt"],
        "allowedSourceRefs": prepared_body["allowedSourceRefs"],
        "temperature": 0,
        "maxTokens": 2048,
    },
)
assert generated.status_code == 200, (
    f"Generate HTTP {generated.status_code}, code="
    f"{generated.json().get('detail', {}).get('code')}, "
    f"Ollama attempts={ollama_client.attempts}"
)
summary = generated.json()["result"]
print("Executive summary:", summary["executive_summary"])
print("Decisions:", summary["decisions"])
print("Action items:", summary["action_items"])

assert summary["executive_summary"]
assert "postgresql" in summary["executive_summary"].casefold(), (
    "Executive summary must contain a fact supported by this transcript"
)
assert SOURCE_REF not in summary["executive_summary"]
assert summary["executive_summary_refs"] == [SOURCE_REF]
assert any("postgresql" in item["text"].casefold() for item in summary["decisions"])
assert all(item["source_refs"] == [SOURCE_REF] for item in summary["decisions"])
task = next(
    (item for item in summary["action_items"] if item["assignee"] == "Minh"),
    None,
)
assert task is not None and "api" in task["title"].casefold()
assert task["deadline"] is None
assert task["deadline_raw"] == "trước thứ Sáu"
assert task["source_refs"] == [SOURCE_REF]

print("Prepare: HTTP 200")
print("Generate: HTTP 200")
print("Model:", generated.json()["modelIdentifier"])
print("Ollama attempts:", ollama_client.attempts)
print("Validation: SUCCESS")
print("Decision count:", len(summary["decisions"]))
print("Action count:", len(summary["action_items"]))
