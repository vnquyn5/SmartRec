"""Internal prompt preparation, local-only inference and output validation."""

import hmac
import logging
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, status

from app.core.config import settings
from app.schemas.local_llm import (
    LocalInferenceRequest,
    LocalInferenceResponse,
    PrepareInferenceRequest,
    PrepareInferenceResponse,
    TokenMetadata,
    ValidateInferenceRequest,
    ValidatedInferenceResponse,
)
from app.schemas.meeting_summary import MeetingSummary, SCHEMA_VERSION
from app.services.local_llm_client import LocalLLMClient, LocalLLMError
from app.services.meeting_summary_json import (
    SummaryErrorCode,
    SummaryValidationError,
    validate_summary_output,
)
from app.services.meeting_summary_prompt import SYSTEM_PROMPT, build_meeting_summary_prompt


logger = logging.getLogger("smartrec.internal_llm")
router = APIRouter(prefix="/internal/llm", tags=["Internal LLM"])
local_llm_client = LocalLLMClient()


def _authenticate(x_internal_token: str | None) -> None:
    configured = settings.smartrec_internal_token
    if not configured or not x_internal_token or not hmac.compare_digest(configured, x_internal_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_INTERNAL_TOKEN"})


def _validated_summary(raw_output: str, refs: list[str]) -> MeetingSummary:
    try:
        summary = validate_summary_output(raw_output, MeetingSummary, set(refs))
        if refs and summary.executive_summary is None:
            raise SummaryValidationError(
                SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
                "A summary is required when verified source evidence is available",
            )
        return summary
    except SummaryValidationError as exc:
        logger.warning("Local LLM output failed validation: %s", exc.code.value)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": exc.code.value},
        ) from exc


@router.post("/prepare", response_model=PrepareInferenceResponse)
def prepare_inference(
    request: PrepareInferenceRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> PrepareInferenceResponse:
    _authenticate(x_internal_token)
    if not any(item.source_type == "TRANSCRIPT" for item in request.evidence):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "TRANSCRIPT_REQUIRED"},
        )

    refs = []
    evidence_blocks = []
    for item in request.evidence:
        ref = item.source_ref
        refs.append(ref)
        metadata = (
            f"[speaker_id={item.speaker_id or 'UNKNOWN'}; "
            f"start_time_ms={item.start_time_ms}; end_time_ms={item.end_time_ms}]\n"
        )
        evidence_blocks.append({
            "source_ref": ref,
            "source_type": item.source_type,
            "text": metadata + item.text,
        })

    try:
        prompt = build_meeting_summary_prompt(evidence_blocks)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_CONTEXT"},
        ) from exc

    return PrepareInferenceResponse(
        contractVersion="smartrec.local-llm.v1",
        requestId=request.request_id,
        jobId=request.job_id,
        meetingId=request.meeting_id,
        taskType=request.task_type,
        systemPrompt=SYSTEM_PROMPT,
        prompt=prompt,
        allowedSourceRefs=refs,
        schemaVersion=SCHEMA_VERSION,
    )


@router.post("/generate", response_model=LocalInferenceResponse)
def generate_local(
    request: LocalInferenceRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> LocalInferenceResponse:
    _authenticate(x_internal_token)
    try:
        generated = local_llm_client.generate(
            prompt=request.prompt,
            system_prompt=request.system_prompt,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )
    except LocalLLMError as exc:
        logger.warning("Local inference rejected: %s", exc.code)
        code = exc.code
        response_status = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if code in {"LOCAL_MODEL_NOT_CONFIGURED", "LOCAL_MODEL_UNAVAILABLE", "LOCAL_MODEL_TIMEOUT"}
            else status.HTTP_502_BAD_GATEWAY
        )
        raise HTTPException(status_code=response_status, detail={"code": code}) from exc

    summary = _validated_summary(generated["text"], request.allowed_source_refs)
    return LocalInferenceResponse(
        contractVersion="smartrec.local-llm.v1",
        requestId=request.request_id,
        jobId=request.job_id,
        meetingId=request.meeting_id,
        taskType=request.task_type,
        modelIdentifier=generated["model_identifier"],
        result=summary,
        tokenMetadata=TokenMetadata(
            inputTokens=generated["input_tokens"],
            outputTokens=generated["output_tokens"],
            totalTokens=generated["total_tokens"],
            source=generated["token_source"],
        ),
        processingTimeMs=generated["processing_time_ms"],
    )


@router.post("/validate", response_model=ValidatedInferenceResponse)
def validate_fallback_output(
    request: ValidateInferenceRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> ValidatedInferenceResponse:
    _authenticate(x_internal_token)
    summary = _validated_summary(request.raw_output, request.allowed_source_refs)
    return ValidatedInferenceResponse(
        contractVersion="smartrec.local-llm.v1",
        requestId=request.request_id,
        jobId=request.job_id,
        meetingId=request.meeting_id,
        taskType=request.task_type,
        result=summary,
    )
