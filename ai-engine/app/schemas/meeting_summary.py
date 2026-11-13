"""Strict Pydantic schemas for SmartRec enterprise meeting summaries."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator, model_validator


SCHEMA_VERSION = "smartrec.ai.meeting-summary.v1"
NON_BLANK_PATTERN = r"^.*[^ \t\r\n].*$"
ISO_DATE_PATTERN = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"


class StrictSummaryModel(BaseModel):
    """Base schema: no extra fields and no implicit type coercion."""

    model_config = ConfigDict(extra="forbid", strict=True)


class EvidenceItem(StrictSummaryModel):
    """A factual statement supported by meeting evidence."""

    text: StrictStr = Field(min_length=1)
    source_refs: list[StrictStr] = Field(min_length=1)


class DiscussionPoint(StrictSummaryModel):
    """A meeting topic, including unapproved proposals."""

    text: StrictStr = Field(min_length=1)
    kind: Literal["DISCUSSION", "PROPOSAL"]
    source_refs: list[StrictStr] = Field(min_length=1)


class ActionItem(StrictSummaryModel):
    """An assigned or proposed task extracted from a meeting."""

    title: StrictStr = Field(min_length=1)
    assignee: StrictStr | None
    deadline: StrictStr | None = Field(pattern=ISO_DATE_PATTERN)
    deadline_raw: StrictStr | None = Field(pattern=NON_BLANK_PATTERN)
    source_refs: list[StrictStr] = Field(min_length=1)

    @field_validator("deadline")
    @classmethod
    def validate_deadline_date(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("deadline must be a valid YYYY-MM-DD calendar date") from exc
        return value


class SourceConflict(StrictSummaryModel):
    """Conflicting statements preserved without choosing a winner."""

    description: StrictStr = Field(min_length=1)
    source_refs: list[StrictStr] = Field(min_length=2)


class MeetingSummary(StrictSummaryModel):
    """AI-owned output contract, not the Backend persistence DTO."""

    @staticmethod
    def _json_schema_extra(schema: dict) -> None:
        # Pydantic validators are runtime-only by default. Mirror the
        # executive summary/reference cross-field invariant in the JSON
        # Schema supplied to Ollama's constrained decoder.
        schema["allOf"] = [
            {
                "anyOf": [
                    {
                        "properties": {
                            "executive_summary": {"type": "string"},
                            "executive_summary_refs": {"minItems": 1},
                        }
                    },
                    {
                        "properties": {
                            "executive_summary": {"type": "null"},
                            "executive_summary_refs": {"maxItems": 0},
                        }
                    },
                ]
            }
        ]

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        json_schema_extra=_json_schema_extra.__func__,
    )

    schema_version: Literal["smartrec.ai.meeting-summary.v1"]

    executive_summary: StrictStr | None = Field(pattern=NON_BLANK_PATTERN)

    executive_summary_refs: list[StrictStr]

    key_points: list[DiscussionPoint]

    decisions: list[EvidenceItem]

    action_items: list[ActionItem]

    open_issues: list[EvidenceItem]

    next_steps: list[EvidenceItem]

    conflicts: list[SourceConflict]

    @model_validator(mode="after")
    def validate_evidence(self):
        if self.executive_summary is not None:
            if not self.executive_summary.strip():
                raise ValueError(
                    "executive_summary must not be blank"
                )
            if not self.executive_summary_refs:
                raise ValueError(
                    "executive_summary requires source references"
                )
        elif self.executive_summary_refs:
            raise ValueError(
                "null executive_summary must not have references"
            )

        for item in self.action_items:
            if item.deadline is not None and not item.deadline.strip():
                raise ValueError("deadline must not be blank")
            if item.deadline_raw is not None and not item.deadline_raw.strip():
                raise ValueError("deadline_raw must not be blank")

        return self


class ActionCandidate(StrictSummaryModel):
    """An extracted task before meeting-summary composition."""

    title: StrictStr = Field(min_length=1)
    assignee: StrictStr | None
    deadline_raw: StrictStr | None
    source_refs: list[StrictStr] = Field(min_length=1)


class ActionExtraction(StrictSummaryModel):
    """Focused output for Action Item extraction."""

    action_items: list[ActionCandidate]


class ClassificationExtraction(StrictSummaryModel):
    """Focused output for decisions, proposals and open issues."""

    decisions: list[EvidenceItem]
    proposals: list[EvidenceItem]
    open_issues: list[EvidenceItem]
