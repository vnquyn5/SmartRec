"""Internal prompt preparation, local-only inference and output validation."""

import hmac
import json
import logging
import re
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
RETRYABLE_VALIDATION_CODES = {
    SummaryErrorCode.JSON_PARSE_ERROR,
    SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
    SummaryErrorCode.SOURCE_REFERENCE_ERROR,
}
RETRY_HINTS = {
    "summary_required": (
        "Provide a short non-empty executive_summary sentence grounded in the evidence, "
        "and cite its exact source_ref IDs."
    ),
    "confirmed_decision_missing": (
        "Include each explicit affirmative agreement in decisions with its supporting source_refs."
    ),
    "assigned_task_missing": (
        "Include each explicit person-to-task assignment in action_items with supporting source_refs."
    ),
    "explicit_assignee_missing": (
        "Use the explicitly named assignee from the cited evidence; do not infer a different person."
    ),
    "relative_deadline_not_preserved": (
        "For the cited assigned task, set deadline to null and deadline_raw to the complete relative "
        "deadline phrase copied exactly from evidence, including words such as 'trước' or 'sau'. "
        "Do not shorten it or use null when the phrase is present."
    ),
}


def _require_llm_enabled() -> None:
    if not settings.smartrec_llm_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "LLM_DISABLED"},
        )


def _authenticate(x_internal_token: str | None) -> None:
    configured = settings.smartrec_internal_token
    if not configured or not x_internal_token or not hmac.compare_digest(configured, x_internal_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_INTERNAL_TOKEN"})


def _prompt_evidence_blocks(prompt: str) -> list[dict]:
    marker = "EVIDENCE_JSON:\n"
    if not isinstance(prompt, str) or marker not in prompt:
        return []
    try:
        evidence = json.loads(prompt.split(marker, 1)[1])
    except (TypeError, ValueError):
        return []
    return [block for block in evidence if isinstance(block, dict)] if isinstance(evidence, list) else []


def _coverage_diagnostics(summary: MeetingSummary, prompt: str) -> tuple[dict, ...]:
    """Reject a few clear, affirmative Vietnamese cues if their category is omitted.

    This is a completeness guard only: it never constructs output content and
    deliberately recognizes narrow, unambiguous phrasings rather than guessing
    from loose keyword matches.
    """
    diagnostics = []
    decision_cue = re.compile(r"\b(?:đã\s+thống\s+nhất|đã\s+quyết\s+định|đã\s+phê\s+duyệt)\b", re.I)
    assignment_cue = re.compile(r"\bđược\s+giao\b", re.I)
    relative_deadline = re.compile(
        r"\b(?:trước|sau)\s+(?:thứ\s+(?:hai|ba|tư|năm|sáu|bảy)|"
        r"cuối\s+tuần|ngày\s+\d{1,2})\b",
        re.I,
    )

    decisions_by_ref = {
        ref
        for decision in summary.decisions
        for ref in decision.source_refs
    }
    action_items_by_ref = {
        ref: []
        for item in summary.action_items
        for ref in item.source_refs
    }
    for item in summary.action_items:
        for ref in item.source_refs:
            action_items_by_ref[ref].append(item)

    for block in _prompt_evidence_blocks(prompt):
        ref = block.get("source_ref")
        text = block.get("text")
        if not isinstance(ref, str) or not isinstance(text, str):
            continue

        sentences = re.split(r"(?<=[.!?])\s+", text)
        for sentence in sentences:
            if decision_cue.search(sentence) and ref not in decisions_by_ref:
                diagnostics.append({
                    "path": "decisions",
                    "type": "evidence_coverage",
                    "code": "confirmed_decision_missing",
                })
                break

        assignment_sentences = [
            sentence
            for sentence in sentences
            if assignment_cue.search(sentence)
            and not re.search(r"\b(?:không|chưa)\s+được\s+giao\b", sentence, re.I)
        ]
        if assignment_sentences:
            items = action_items_by_ref.get(ref, [])
            if not items:
                diagnostics.append({
                    "path": "action_items",
                    "type": "evidence_coverage",
                    "code": "assigned_task_missing",
                })
                continue

            for sentence in assignment_sentences:
                assignee_match = re.search(
                    r"\b([A-ZÀ-ỸĐ][\wÀ-ỹĐđ]*)\s+được\s+giao\b",
                    sentence,
                )
                if assignee_match:
                    expected_assignee = assignee_match.group(1).casefold()
                    if not any(
                        item.assignee and item.assignee.casefold() == expected_assignee
                        for item in items
                    ):
                        diagnostics.append({
                            "path": "action_items.assignee",
                            "type": "evidence_coverage",
                            "code": "explicit_assignee_missing",
                        })

                deadline_match = relative_deadline.search(sentence)
                if deadline_match and not any(
                    item.deadline is None
                    and item.deadline_raw
                    and deadline_match.group(0).casefold() in item.deadline_raw.casefold()
                    for item in items
                ):
                    diagnostics.append({
                        "path": "action_items.deadline_raw",
                        "type": "evidence_coverage",
                        "code": "relative_deadline_not_preserved",
                    })

    # Keep one copy of each safe path/code and bound log/retry prompt size.
    unique = {(item["path"], item["type"], item["code"]): item for item in diagnostics}
    return tuple(list(unique.values())[:20])


def _validate_summary(
    raw_output: str,
    refs: list[str],
    prompt: str | None = None,
) -> MeetingSummary:
    summary = validate_summary_output(raw_output, MeetingSummary, set(refs))
    if refs and summary.executive_summary is None:
        raise SummaryValidationError(
            SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
            "A summary is required when verified source evidence is available",
            diagnostics=(
                {
                    "path": "executive_summary",
                    "type": "schema_validation",
                    "code": "summary_required",
                },
            ),
        )
    if prompt is not None:
        diagnostics = _coverage_diagnostics(summary, prompt)
        if diagnostics:
            raise SummaryValidationError(
                SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
                "Required evidence coverage is missing",
                diagnostics=diagnostics,
            )
    return summary


def _error_with_done_reason(
    exc: SummaryValidationError,
    done_reason: str | None,
) -> SummaryValidationError:
    if done_reason == "length" and exc.code in {
        SummaryErrorCode.JSON_PARSE_ERROR,
        SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
    }:
        return SummaryValidationError(
            SummaryErrorCode.GENERATION_TRUNCATED,
            "Generation stopped at the token limit before validation passed",
            diagnostics=exc.diagnostics,
        )
    return exc


def _raise_validation_http(
    exc: SummaryValidationError,
    done_reason: str | None,
) -> None:
    error = _error_with_done_reason(exc, done_reason)
    logger.warning(
        "Local LLM output failed validation: code=%s done_reason=%s diagnostics=%s",
        error.code.value,
        done_reason or "unknown",
        list(error.diagnostics),
    )
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={"code": error.code.value},
    ) from exc


def _retry_system_prompt(system_prompt: str, error: SummaryValidationError) -> str:
    diagnostics = list(error.diagnostics) or [
        {"path": "$", "type": "validation", "code": error.code.value}
    ]
    hints = [
        RETRY_HINTS[diagnostic["code"]]
        for diagnostic in diagnostics
        if diagnostic.get("code") in RETRY_HINTS
    ]
    return (
        system_prompt
        + "\n\nVALIDATION RETRY: Your previous response was rejected. "
        "Regenerate the entire JSON object using the evidence in the request. "
        "Correct only the reported contract violations. Do not invent or infer "
        "facts, people, decisions, tasks, deadlines, or source references. "
        "When evidence is present, executive_summary must be a short, non-empty "
        "evidence-grounded string with executive_summary_refs set to exact "
        "source_ref IDs from the request. Safe validation diagnostics: "
        + json.dumps(diagnostics, ensure_ascii=False, separators=(",", ":"))
        + (" Specific corrections: " + " ".join(hints) if hints else "")
    )


def _validated_summary(
    raw_output: str,
    refs: list[str],
    done_reason: str | None = None,
) -> MeetingSummary:
    try:
        return _validate_summary(raw_output, refs)
    except SummaryValidationError as exc:
        _raise_validation_http(exc, done_reason)


def _raise_local_generation_error(exc: LocalLLMError) -> None:
    logger.warning("Local inference rejected: code=%s", exc.code)
    response_status = (
        status.HTTP_503_SERVICE_UNAVAILABLE
        if exc.code in {
            "LOCAL_MODEL_NOT_CONFIGURED",
            "LOCAL_MODEL_UNAVAILABLE",
            "LOCAL_MODEL_TIMEOUT",
        }
        else status.HTTP_502_BAD_GATEWAY
    )
    raise HTTPException(
        status_code=response_status,
        detail={"code": exc.code},
    ) from exc


def _combine_generation_metadata(first: dict, second: dict) -> dict:
    """Return the accepted attempt and aggregate known cost/time metadata."""
    combined = dict(second)
    first_counts = (first.get("input_tokens"), first.get("output_tokens"))
    second_counts = (second.get("input_tokens"), second.get("output_tokens"))
    if all(isinstance(value, int) for value in (*first_counts, *second_counts)):
        combined["input_tokens"] = first_counts[0] + second_counts[0]
        combined["output_tokens"] = first_counts[1] + second_counts[1]
        combined["total_tokens"] = combined["input_tokens"] + combined["output_tokens"]
        combined["token_source"] = "ollama_metadata"
    else:
        combined["input_tokens"] = None
        combined["output_tokens"] = None
        combined["total_tokens"] = None
        combined["token_source"] = "unavailable"
    combined["processing_time_ms"] = (
        (first.get("processing_time_ms") or 0)
        + (second.get("processing_time_ms") or 0)
    )
    return combined


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
    _require_llm_enabled()
    try:
        generated = local_llm_client.generate(
            prompt=request.prompt,
            system_prompt=request.system_prompt,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )
    except LocalLLMError as exc:
        _raise_local_generation_error(exc)

    try:
        summary = _validate_summary(
            generated["text"], request.allowed_source_refs, request.prompt
        )
    except SummaryValidationError as first_error:
        first_error = _error_with_done_reason(first_error, generated.get("done_reason"))
        if first_error.code not in RETRYABLE_VALIDATION_CODES:
            _raise_validation_http(first_error, generated.get("done_reason"))

        logger.info(
            "Retrying local inference after validation failure: code=%s diagnostics=%s",
            first_error.code.value,
            list(first_error.diagnostics),
        )
        try:
            retried = local_llm_client.generate(
                prompt=request.prompt,
                system_prompt=_retry_system_prompt(request.system_prompt, first_error),
                temperature=request.temperature,
                max_tokens=request.max_tokens,
            )
        except LocalLLMError as exc:
            _raise_local_generation_error(exc)

        try:
            summary = _validate_summary(
                retried["text"], request.allowed_source_refs, request.prompt
            )
        except SummaryValidationError as retry_error:
            _raise_validation_http(retry_error, retried.get("done_reason"))
        generated = _combine_generation_metadata(generated, retried)

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
    summary = _validated_summary(request.raw_output, request.allowed_source_refs)
    return ValidatedInferenceResponse(
        contractVersion="smartrec.local-llm.v1",
        requestId=request.request_id,
        jobId=request.job_id,
        meetingId=request.meeting_id,
        taskType=request.task_type,
        result=summary,
    )
