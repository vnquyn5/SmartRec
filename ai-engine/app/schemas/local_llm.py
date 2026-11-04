"""Versioned internal contract for local LLM inference."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator

from app.schemas.meeting_summary import MeetingSummary


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ContextEvidence(ContractModel):
    source_type: Literal["TRANSCRIPT", "SLIDE_OCR"] = Field(alias="sourceType")
    source_id: UUID = Field(alias="sourceId")
    speaker_id: UUID | None = Field(default=None, alias="speakerId")
    start_time_ms: int = Field(ge=0, alias="startTimeMs")
    end_time_ms: int = Field(ge=0, alias="endTimeMs")
    text: StrictStr = Field(min_length=1)

    @model_validator(mode="after")
    def validate_range(self):
        if self.end_time_ms < self.start_time_ms:
            raise ValueError("endTimeMs must not precede startTimeMs")
        if not self.text.strip():
            raise ValueError("evidence text must not be blank")
        return self

    @property
    def source_ref(self) -> str:
        return f"{self.source_type}:{self.source_id}"


class PrepareInferenceRequest(ContractModel):
    contract_version: Literal["smartrec.local-llm.v1"] = Field(alias="contractVersion")
    request_id: UUID = Field(alias="requestId")
    job_id: UUID = Field(alias="jobId")
    meeting_id: UUID = Field(alias="meetingId")
    task_type: Literal["MEETING_ANALYSIS"] = Field(alias="taskType")
    evidence: list[ContextEvidence] = Field(min_length=1)


class PrepareInferenceResponse(ContractModel):
    contract_version: Literal["smartrec.local-llm.v1"] = Field(alias="contractVersion")
    request_id: UUID = Field(alias="requestId")
    job_id: UUID = Field(alias="jobId")
    meeting_id: UUID = Field(alias="meetingId")
    task_type: Literal["MEETING_ANALYSIS"] = Field(alias="taskType")
    system_prompt: StrictStr = Field(alias="systemPrompt")
    prompt: StrictStr
    allowed_source_refs: list[StrictStr] = Field(alias="allowedSourceRefs")
    schema_version: Literal["smartrec.ai.meeting-summary.v1"] = Field(alias="schemaVersion")


class LocalInferenceRequest(ContractModel):
    contract_version: Literal["smartrec.local-llm.v1"] = Field(alias="contractVersion")
    request_id: UUID = Field(alias="requestId")
    job_id: UUID = Field(alias="jobId")
    meeting_id: UUID = Field(alias="meetingId")
    task_type: Literal["MEETING_ANALYSIS"] = Field(alias="taskType")
    system_prompt: StrictStr = Field(alias="systemPrompt", min_length=1)
    prompt: StrictStr = Field(min_length=1)
    allowed_source_refs: list[StrictStr] = Field(alias="allowedSourceRefs", min_length=1)
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, alias="maxTokens", ge=1, le=8192)


class ValidateInferenceRequest(ContractModel):
    contract_version: Literal["smartrec.local-llm.v1"] = Field(alias="contractVersion")
    request_id: UUID = Field(alias="requestId")
    job_id: UUID = Field(alias="jobId")
    meeting_id: UUID = Field(alias="meetingId")
    task_type: Literal["MEETING_ANALYSIS"] = Field(alias="taskType")
    raw_output: StrictStr = Field(alias="rawOutput", min_length=1)
    allowed_source_refs: list[StrictStr] = Field(alias="allowedSourceRefs", min_length=1)


class TokenMetadata(ContractModel):
    input_tokens: int | None = Field(default=None, alias="inputTokens", ge=0)
    output_tokens: int | None = Field(default=None, alias="outputTokens", ge=0)
    total_tokens: int | None = Field(default=None, alias="totalTokens", ge=0)
    source: Literal["ollama_metadata", "unavailable"] = "unavailable"


class LocalInferenceResponse(ContractModel):
    contract_version: Literal["smartrec.local-llm.v1"] = Field(alias="contractVersion")
    request_id: UUID = Field(alias="requestId")
    job_id: UUID = Field(alias="jobId")
    meeting_id: UUID = Field(alias="meetingId")
    task_type: Literal["MEETING_ANALYSIS"] = Field(alias="taskType")
    provider: Literal["LOCAL"] = "LOCAL"
    model_identifier: StrictStr = Field(alias="modelIdentifier")
    status: Literal["SUCCESS"] = "SUCCESS"
    result: MeetingSummary
    token_metadata: TokenMetadata = Field(alias="tokenMetadata")
    processing_time_ms: int = Field(alias="processingTimeMs", ge=0)


class ValidatedInferenceResponse(ContractModel):
    contract_version: Literal["smartrec.local-llm.v1"] = Field(alias="contractVersion")
    request_id: UUID = Field(alias="requestId")
    job_id: UUID = Field(alias="jobId")
    meeting_id: UUID = Field(alias="meetingId")
    task_type: Literal["MEETING_ANALYSIS"] = Field(alias="taskType")
    result: MeetingSummary
