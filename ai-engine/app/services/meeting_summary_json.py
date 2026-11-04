"""Safe JSON parsing and citation validation for SmartRec summaries."""

import json
import re
from enum import Enum
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.schemas.meeting_summary import (
    ActionExtraction,
    ClassificationExtraction,
    MeetingSummary,
)


class SummaryErrorCode(str, Enum):
    GENERATION_ERROR = "GENERATION_ERROR"
    JSON_PARSE_ERROR = "JSON_PARSE_ERROR"
    SCHEMA_VALIDATION_ERROR = "SCHEMA_VALIDATION_ERROR"
    SOURCE_REFERENCE_ERROR = "SOURCE_REFERENCE_ERROR"


class SummaryValidationError(ValueError):
    """An AI-layer error; not a Backend error contract."""

    def __init__(self, code: SummaryErrorCode, message: str):
        self.code = code
        super().__init__(message)


ModelT = TypeVar("ModelT", bound=BaseModel)

SUPPORTED_MODELS = (
    ActionExtraction,
    ClassificationExtraction,
    MeetingSummary,
)


def _remove_outer_fence(text: str) -> str:
    """Remove one balanced outer Markdown JSON fence, if present."""
    value = text.strip()

    match = re.fullmatch(
        r"```(?:json)?[ \t]*\r?\n(.*?)\r?\n```",
        value,
        flags=re.DOTALL | re.IGNORECASE,
    )

    return match.group(1).strip() if match else value


def _remove_trailing_commas(text: str) -> str:
    """Remove commas immediately before ] or }, outside JSON strings."""
    result = []
    in_string = False
    escaped = False

    for index, char in enumerate(text):
        if in_string:
            result.append(char)

            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False

            continue

        if char == '"':
            in_string = True
            result.append(char)
            continue

        if char == ",":
            next_index = index + 1

            while (
                next_index < len(text)
                and text[next_index] in " \t\r\n"
            ):
                next_index += 1

            if (
                next_index < len(text)
                and text[next_index] in "}]"
            ):
                continue

        result.append(char)

    return "".join(result)



def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    """Reject duplicate keys at every JSON object nesting level."""
    result = {}

    for key, value in pairs:
        if key in result:
            raise SummaryValidationError(
                SummaryErrorCode.JSON_PARSE_ERROR,
                f"Duplicate JSON key: {key}",
            )

        result[key] = value

    return result

def sanitize_json(raw_output: str) -> dict:
    """Parse raw model output with narrowly limited syntax repair."""

    if not isinstance(raw_output, str) or not raw_output.strip():
        raise SummaryValidationError(
            SummaryErrorCode.GENERATION_ERROR,
            "Model returned an empty or non-string response",
        )

    cleaned = _remove_outer_fence(raw_output)

    try:
        parsed = json.loads(cleaned, object_pairs_hook=_reject_duplicate_keys)
    except json.JSONDecodeError:
        repaired = _remove_trailing_commas(cleaned)

        if repaired == cleaned:
            raise SummaryValidationError(
                SummaryErrorCode.JSON_PARSE_ERROR,
                "Invalid JSON output",
            )

        try:
            parsed = json.loads(repaired, object_pairs_hook=_reject_duplicate_keys)
        except json.JSONDecodeError as exc:
            raise SummaryValidationError(
                SummaryErrorCode.JSON_PARSE_ERROR,
                "JSON could not be safely repaired",
            ) from exc

    if not isinstance(parsed, dict):
        raise SummaryValidationError(
            SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
            "Expected a JSON object",
        )

    return parsed


def _collect_source_refs(model: BaseModel) -> set[str]:
    """Collect all citation IDs from supported output models."""
    refs = set()

    if isinstance(model, MeetingSummary):
        refs.update(model.executive_summary_refs)

        groups = (
            model.key_points,
            model.decisions,
            model.action_items,
            model.open_issues,
            model.next_steps,
            model.conflicts,
        )

    elif isinstance(model, ActionExtraction):
        groups = (model.action_items,)

    elif isinstance(model, ClassificationExtraction):
        groups = (
            model.decisions,
            model.proposals,
            model.open_issues,
        )

    else:
        raise TypeError("Unsupported summary model")

    for group in groups:
        for item in group:
            refs.update(item.source_refs)

    return refs


def validate_summary_output(
    raw_output: str,
    model_class: type[ModelT],
    allowed_source_refs: set[str],
) -> ModelT:
    """Parse, validate strict schema, and check citation allowlist.

    allowed_source_refs must be supplied by a trusted caller after
    source provenance verification. This does not verify source
    contents, citation support, or persistent Backend artifact IDs.
    """

    if model_class not in SUPPORTED_MODELS:
        raise TypeError("Unsupported model_class")

    if not isinstance(allowed_source_refs, set) or not all(
        isinstance(ref, str) and bool(ref.strip())
        for ref in allowed_source_refs
    ):
        raise TypeError(
            "allowed_source_refs must be a set of nonempty strings"
        )

    parsed = sanitize_json(raw_output)

    try:
        validated = model_class.model_validate(
            parsed,
            strict=True,
        )
    except ValidationError as exc:
        raise SummaryValidationError(
            SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
            f"Pydantic validation failed: {exc}",
        ) from exc

    output_refs = _collect_source_refs(validated)
    unknown_refs = output_refs - allowed_source_refs

    if unknown_refs:
        raise SummaryValidationError(
            SummaryErrorCode.SOURCE_REFERENCE_ERROR,
            "Unknown citation IDs: " + ", ".join(sorted(unknown_refs)),
        )

    return validated
