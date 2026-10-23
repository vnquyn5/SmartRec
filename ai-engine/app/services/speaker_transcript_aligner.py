"""Ghép các đoạn Whisper với speaker timeline từ Diarization."""

import math
from collections import defaultdict
from typing import Any, Mapping, Optional, Sequence
from uuid import UUID


def align_speakers(
    whisper_segments: Sequence[Any],
    diarization_timeline: Sequence[Any],
    speaker_uuid_mapping: Mapping[str, UUID],
) -> dict[int, Optional[UUID]]:
    """
    Ghép speaker theo tổng thời gian giao nhau giữa các segments.

    speaker_uuid_mapping:
        Ánh xạ raw speaker ID hoặc friendly label sang UUID Backend.
        Ví dụ: {"SPEAKER_00": UUID(...)}
    """

    result: dict[int, Optional[UUID]] = {}

    for index, whisper_segment in enumerate(whisper_segments):
        start = float(whisper_segment.start)
        end = float(whisper_segment.end)

        if not (math.isfinite(start) and math.isfinite(end)):
            raise ValueError(f"Whisper segment #{index} có timestamp không hữu hạn.")

        if start < 0 or end < start:
            raise ValueError(f"Whisper segment #{index} có timestamp không hợp lệ.")

        overlap_by_speaker = defaultdict(float)

        for diarization_segment in diarization_timeline:
            diar_start = float(diarization_segment.start_seconds)
            diar_end = float(diarization_segment.end_seconds)

            if not (math.isfinite(diar_start) and math.isfinite(diar_end)):
                raise ValueError("Diarization timeline có timestamp không hữu hạn.")

            if diar_start < 0 or diar_end < diar_start:
                raise ValueError("Diarization timeline có timestamp không hợp lệ.")

            overlap = max(
                0.0,
                min(end, diar_end) - max(start, diar_start),
            )

            if overlap <= 0:
                continue

            raw_id = getattr(diarization_segment, "raw_speaker_id", None)
            label = getattr(diarization_segment, "speaker", None)

            speaker_key = raw_id or label

            if speaker_key:
                overlap_by_speaker[speaker_key] += overlap

        if not overlap_by_speaker:
            result[index] = None
            continue

        ranked = sorted(
            overlap_by_speaker.items(),
            key=lambda item: item[1],
            reverse=True,
        )

        # Nếu hai người nói có mức overlap ngang nhau, chưa đủ căn cứ gán.
        if len(ranked) > 1 and math.isclose(
            ranked[0][1],
            ranked[1][1],
            abs_tol=1e-6,
        ):
            result[index] = None
            continue

        matched_key = ranked[0][0]

        matched_uuid = speaker_uuid_mapping.get(matched_key)

        if matched_uuid is None:
            # Cho phép ánh xạ bằng friendly label nếu Backend dùng nhãn đó.
            for diarization_segment in diarization_timeline:
                if (
                    getattr(diarization_segment, "raw_speaker_id", None)
                    == matched_key
                ):
                    label = getattr(diarization_segment, "speaker", None)
                    matched_uuid = speaker_uuid_mapping.get(label)
                    if matched_uuid is not None:
                        break

        result[index] = matched_uuid

    return result
