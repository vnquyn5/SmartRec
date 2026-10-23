"""Schemas cho kết quả Speech-to-Text của SmartRec."""

from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TranscriptSegment(BaseModel):
    """Một câu thoại có timestamp và speaker ID tùy chọn."""

    model_config = ConfigDict(extra="forbid")

    speakerId: Optional[UUID] = None
    startTimeMs: int = Field(..., ge=0)
    endTimeMs: int = Field(..., ge=0)
    text: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_timestamps(self):
        if self.endTimeMs < self.startTimeMs:
            raise ValueError("endTimeMs không được nhỏ hơn startTimeMs")
        return self


class TranscriptPayload(BaseModel):
    """Payload transcript tương thích cấu trúc Backend cung cấp."""

    model_config = ConfigDict(extra="forbid")

    meetingId: UUID
    processingJobId: UUID
    success: bool = True
    language: str = Field(default="vi", min_length=1)
    modelName: str = Field(default="whisper", min_length=1)
    segments: List[TranscriptSegment] = Field(default_factory=list)
