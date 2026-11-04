"""Strict Pydantic schemas for SmartRec enterprise meeting summaries."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator


SCHEMA_VERSION = "smartrec.ai.meeting-summary.v1"


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

    title: StrictStr = Field(
        min_length=1,
        description="A task supported by meeting evidence; include every explicit assignment.",
    )
    assignee: StrictStr | None
    deadline: StrictStr | None
    deadline_raw: StrictStr | None = Field(
        description=(
            "For a relative or ambiguous deadline, preserve the complete original "
            "phrase verbatim, including relational words such as 'trước' or 'sau'."
        ),
    )
    source_refs: list[StrictStr] = Field(min_length=1)


class SourceConflict(StrictSummaryModel):
    """Conflicting statements preserved without choosing a winner."""

    description: StrictStr = Field(min_length=1)
    source_refs: list[StrictStr] = Field(min_length=2)


class MeetingSummary(StrictSummaryModel):
    """AI-owned output contract, not the Backend persistence DTO."""

    schema_version: Literal["smartrec.ai.meeting-summary.v1"]

    executive_summary: StrictStr | None = Field(
        description=(
            "A concise natural-language summary grounded in evidence; required "
            "when evidence is provided, never a field label or source ID."
        ),
    )

    executive_summary_refs: list[StrictStr] = Field(
        description="Exact evidence source_ref IDs supporting executive_summary.",
    )

    key_points: list[DiscussionPoint]

    decisions: list[EvidenceItem] = Field(
        description="All explicitly confirmed decisions, each grounded and cited.",
    )

    action_items: list[ActionItem] = Field(
        description="All explicit evidence-supported task assignments, each cited.",
    )

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
