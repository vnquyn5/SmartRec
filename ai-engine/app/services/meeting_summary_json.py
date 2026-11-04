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
    GENERATION_TRUNCATED = "GENERATION_TRUNCATED"
    JSON_PARSE_ERROR = "JSON_PARSE_ERROR"
    SCHEMA_VALIDATION_ERROR = "SCHEMA_VALIDATION_ERROR"
    SOURCE_REFERENCE_ERROR = "SOURCE_REFERENCE_ERROR"


class SummaryValidationError(ValueError):
    """An AI-layer error; not a Backend error contract."""

    def __init__(self, code: SummaryErrorCode, message: str, diagnostics=None):
        self.code = code
        self.diagnostics = tuple(diagnostics or ())
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
            diagnostics=({"path": "$", "type": "schema_validation", "code": "object_type"},),
        )

    return parsed


def _collect_source_ref_paths(model: BaseModel) -> dict[str, set[str]]:
    """Map citation field paths to their values without exposing those values."""
    paths = {}

    def visit(value, path=""):
        if isinstance(value, dict):
            for key, child in value.items():
                child_path = f"{path}.{key}" if path else key
                if key in {"source_refs", "executive_summary_refs"} and isinstance(child, list):
                    paths[child_path] = {ref for ref in child if isinstance(ref, str)}
                else:
                    visit(child, child_path)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, f"{path}.{index}" if path else str(index))

    visit(model.model_dump())
    return paths


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
        diagnostics = []
        for error in exc.errors(include_input=False, include_url=False)[:20]:
            location = list(error["loc"])
            # An unknown JSON key is model-controlled and could itself contain
            # sensitive content. Keep its position, but never log its spelling.
            if error["type"] == "extra_forbidden" and location:
                location[-1] = "<unknown>"
            diagnostics.append({
                "path": ".".join(str(part) for part in location) or "$",
                "type": "schema_validation",
                "code": error["type"],
            })
        raise SummaryValidationError(
            SummaryErrorCode.SCHEMA_VALIDATION_ERROR,
            "Pydantic validation failed",
            diagnostics=tuple(diagnostics),
        ) from exc

    ref_paths = _collect_source_ref_paths(validated)
    output_refs = set().union(*ref_paths.values()) if ref_paths else set()
    unknown_refs = output_refs - allowed_source_refs

    if unknown_refs:
        diagnostics = tuple(
            {
                "path": path,
                "type": "source_reference",
                "code": "source_ref_not_allowed",
            }
            for path, refs in ref_paths.items()
            if refs & unknown_refs
        )[:20]
        raise SummaryValidationError(
            SummaryErrorCode.SOURCE_REFERENCE_ERROR,
            "Unknown citation IDs",
            diagnostics=diagnostics,
        )

    return validated
