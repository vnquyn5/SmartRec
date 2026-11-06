"""Internal prompt preparation, local-only inference and output validation."""

import hmac
import json
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
from app.services.meeting_summary_normalization import normalize_summary_from_evidence
from app.services.meeting_summary_references import (
    EvidenceReferenceError,
    build_evidence_reference_map,
    expand_summary_references,
    verify_short_reference_allowlist,
)


logger = logging.getLogger("smartrec.internal_llm")
router = APIRouter(prefix="/internal/llm", tags=["Internal LLM"])
local_llm_client = LocalLLMClient()


def _authenticate(x_internal_token: str | None) -> None:
    configured = settings.smartrec_internal_token
    if not configured or not x_internal_token or not hmac.compare_digest(configured, x_internal_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_INTERNAL_TOKEN"})


def _require_llm_enabled() -> None:
    if not settings.smartrec_llm_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LLM_DISABLED"},
        )


def _validated_summary(raw_output: str, refs: list[str], evidence=None) -> MeetingSummary:
    try:
        reference_map = verify_short_reference_allowlist(evidence or (), refs)
        compact_summary = validate_summary_output(
            raw_output, MeetingSummary, set(reference_map.allowed_short_refs)
        )
        expanded = expand_summary_references(
            compact_summary.model_dump(mode="json"), reference_map
        )
        expanded = normalize_summary_from_evidence(
            expanded, list(reference_map.ordered_evidence)
        )
        summary = validate_summary_output(
            json.dumps(expanded, ensure_ascii=False),
            MeetingSummary,
            reference_map.allowed_original_refs,
            reference_map.ordered_evidence,
        )
        if reference_map.allowed_original_refs and summary.executive_summary is None:
            raise SummaryValidationError(
                SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
                "A summary is required when verified source evidence is available",
                validation_diagnostics=(
                    {"loc": [], "type": "value_error"},
                ),
            )
        return summary
    except EvidenceReferenceError as exc:
        diagnostic = {"loc": ["source_refs"], "type": "evidence_reference_mapping"}
        logger.warning(
            "Local LLM validation failed: category=source_reference number_of_validation_errors=1 diagnostics=%s",
            (diagnostic,),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": SummaryErrorCode.SOURCE_REFERENCE_ERROR.value},
        ) from exc
    except SummaryValidationError as exc:
        if exc.code == SummaryErrorCode.JSON_PARSE_ERROR:
            logger.warning("Local LLM validation failed: category=json_parse")
        elif exc.code == SummaryErrorCode.SOURCE_REFERENCE_ERROR:
            logger.warning(
                "Local LLM validation failed: category=source_reference number_of_validation_errors=%d diagnostics=%s",
                len(exc.validation_diagnostics),
                exc.validation_diagnostics,
            )
        elif exc.code == SummaryErrorCode.EVIDENCE_CONSISTENCY_ERROR:
            logger.warning(
                "Local LLM validation failed: category=evidence_consistency number_of_validation_errors=%d diagnostics=%s",
                len(exc.validation_diagnostics),
                exc.validation_diagnostics,
            )
        elif exc.code == SummaryErrorCode.SCHEMA_VALIDATION_ERROR:
            diagnostics = exc.validation_diagnostics
            has_cross_field_error = any(not item["loc"] for item in diagnostics)
            has_field_error = any(item["loc"] for item in diagnostics)
            if has_cross_field_error and has_field_error:
                category = "pydantic_schema_and_cross_field"
            elif has_cross_field_error:
                category = "cross_field"
            else:
                category = "pydantic_schema"
            logger.warning(
                "Local LLM validation failed: category=%s number_of_validation_errors=%d diagnostics=%s",
                category,
                len(diagnostics),
                diagnostics,
            )
        else:
            logger.warning("Local LLM validation failed: category=generation")
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
    _require_llm_enabled()
    if not any(item.source_type == "TRANSCRIPT" for item in request.evidence):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "TRANSCRIPT_REQUIRED"},
        )

    try:
        reference_map = build_evidence_reference_map(request.evidence)
    except EvidenceReferenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_CONTEXT"},
        ) from exc

    evidence_blocks = []
    for index, item in enumerate(reference_map.ordered_evidence, start=1):
        evidence_blocks.append({
            "source_ref": f"S{index}",
            "source_type": item.source_type,
            # Opaque speaker IDs are omitted so they cannot become names.
            "text": item.text,
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
        allowedSourceRefs=reference_map.allowed_short_refs,
        schemaVersion=SCHEMA_VERSION,
    )


@router.post("/generate", response_model=LocalInferenceResponse)
def generate_local(
    request: LocalInferenceRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> LocalInferenceResponse:
    _authenticate(x_internal_token)
    _require_llm_enabled()
    try:
        verify_short_reference_allowlist(request.evidence, request.allowed_source_refs)
    except EvidenceReferenceError as exc:
        logger.warning(
            "Local LLM request rejected: category=source_reference diagnostics=%s",
            ({"loc": ["allowedSourceRefs"], "type": "evidence_reference_mapping"},),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": SummaryErrorCode.SOURCE_REFERENCE_ERROR.value},
        ) from exc
    try:
        generated = local_llm_client.generate(
            prompt=request.prompt,
            system_prompt=request.system_prompt,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            allowed_source_refs=request.allowed_source_refs,
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

    summary = _validated_summary(
        generated["text"], request.allowed_source_refs, request.evidence
    )
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
    _require_llm_enabled()
    summary = _validated_summary(
        request.raw_output, request.allowed_source_refs, request.evidence
    )
    return ValidatedInferenceResponse(
        contractVersion="smartrec.local-llm.v1",
        requestId=request.request_id,
        jobId=request.job_id,
        meetingId=request.meeting_id,
        taskType=request.task_type,
        result=summary,
    )
