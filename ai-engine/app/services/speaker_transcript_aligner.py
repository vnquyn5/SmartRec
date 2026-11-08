"""Ghép các đoạn Whisper với speaker timeline từ Diarization."""

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence
from uuid import UUID


_MIN_SINGLE_SPEAKER_COVERAGE = 0.90


def _field(value: Any, name: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(name)
    return getattr(value, name, None)


def _union_duration(intervals: Sequence[tuple[float, float]]) -> float:
    """Return covered time without double-counting overlapping same-speaker turns."""
    if not intervals:
        return 0.0
    ordered = sorted(intervals)
    covered = 0.0
    start, end = ordered[0]
    for next_start, next_end in ordered[1:]:
        if next_start <= end:
            end = max(end, next_end)
        else:
            covered += end - start
            start, end = next_start, next_end
    return covered + end - start


@dataclass(frozen=True)
class SpeakerAttribution:
    speaker_key: Optional[str]
    status: str
    overlap_by_speaker: dict[str, float]
    word_assignments: Optional[tuple[tuple[float, float, str, str], ...]] = None


def analyze_speaker_attribution(
    whisper_segments: Sequence[Any],
    diarization_timeline: Sequence[Any],
) -> dict[int, SpeakerAttribution]:
    """Classify transcript intervals without assigning cross-turn text by majority vote."""
    validated_timeline = []
    for diarization_segment in diarization_timeline:
        diar_start = float(diarization_segment.start_seconds)
        diar_end = float(diarization_segment.end_seconds)
        if not (math.isfinite(diar_start) and math.isfinite(diar_end)):
            raise ValueError("Diarization timeline has non-finite timestamps.")
        if diar_start < 0 or diar_end <= diar_start:
            raise ValueError("Diarization timeline has invalid timestamps.")
        raw_id = getattr(diarization_segment, "raw_speaker_id", None)
        label = getattr(diarization_segment, "speaker", None)
        key = raw_id or label
        if key:
            validated_timeline.append((diar_start, diar_end, str(key), label, raw_id))
    validated_timeline.sort(key=lambda item: (item[0], item[1], item[2]))

    results = {}
    for index, segment in enumerate(whisper_segments):
        start, end = float(segment.start), float(segment.end)
        if not (math.isfinite(start) and math.isfinite(end)):
            raise ValueError(f"Whisper segment #{index} has non-finite timestamps.")
        if start < 0 or end < start:
            raise ValueError(f"Whisper segment #{index} has invalid timestamps.")

        overlaps = defaultdict(float)
        covered_turns = []
        overlap_ranges = defaultdict(list)
        for turn_start, turn_end, key, _, _ in validated_timeline:
            overlap = max(0.0, min(end, turn_end) - max(start, turn_start))
            if overlap > 0:
                overlaps[key] += overlap
                covered_turns.append((turn_start, turn_end, key))
                overlap_ranges[key].append((max(start, turn_start), min(end, turn_end)))

        word_assignments = []
        words_are_reliable = bool(getattr(segment, "words", None))
        if words_are_reliable:
            for word in segment.words:
                word_text = _field(word, "word")
                if word_text is None:
                    word_text = _field(word, "text")
                try:
                    word_start = float(_field(word, "start"))
                    word_end = float(_field(word, "end"))
                except (TypeError, ValueError):
                    words_are_reliable = False
                    break
                owners = [
                    key for turn_start, turn_end, key, _, _ in validated_timeline
                    if turn_start <= word_start < word_end <= turn_end
                ]
                if (not isinstance(word_text, str) or not word_text.strip()
                        or not (math.isfinite(word_start) and math.isfinite(word_end))
                        or not (start <= word_start < word_end <= end)
                        or len(owners) != 1):
                    words_are_reliable = False
                    break
                word_assignments.append((word_start, word_end, word_text, owners[0]))

        if not overlaps:
            results[index] = SpeakerAttribution(None, "UNRESOLVED", {}, None)
        elif words_are_reliable and word_assignments:
            reconstructed = "".join(item[2] for item in word_assignments).strip()
            original_text = str(getattr(segment, "text", "") or "").strip()
            if reconstructed == original_text:
                word_owners = {item[3] for item in word_assignments}
                containing_owners = {
                    key for turn_start, turn_end, key, _, _ in validated_timeline
                    if turn_start <= start and end <= turn_end
                }
                if len(word_owners) == 1 and word_owners <= containing_owners:
                    results[index] = SpeakerAttribution(next(iter(word_owners)), "ATTRIBUTED", dict(overlaps))
                else:
                    results[index] = SpeakerAttribution(
                        None, "WORD_LEVEL_SPLIT", dict(overlaps), tuple(word_assignments)
                    )
            else:
                results[index] = SpeakerAttribution(None, "CROSS_SPEAKER_BOUNDARY", dict(overlaps), None)
        else:
            turn_owners = {key for _, _, key in covered_turns}
            containing = {
                key for turn_start, turn_end, key, _, _ in validated_timeline
                if turn_start <= start and end <= turn_end
            }
            if len(turn_owners) > 1:
                results[index] = SpeakerAttribution(None, "CROSS_SPEAKER_BOUNDARY", dict(overlaps))
            elif len(containing) == 1:
                results[index] = SpeakerAttribution(next(iter(containing)), "ATTRIBUTED", dict(overlaps))
            elif end > start and len(turn_owners) == 1:
                key = next(iter(turn_owners))
                coverage = _union_duration(overlap_ranges[key]) / (end - start)
                if coverage >= _MIN_SINGLE_SPEAKER_COVERAGE:
                    results[index] = SpeakerAttribution(key, "ATTRIBUTED", dict(overlaps))
                else:
                    results[index] = SpeakerAttribution(None, "UNRESOLVED", dict(overlaps))
            else:
                results[index] = SpeakerAttribution(None, "UNRESOLVED", dict(overlaps))
    return results


def align_speakers(
    whisper_segments: Sequence[Any],
    diarization_timeline: Sequence[Any],
    speaker_uuid_mapping: Mapping[str, UUID],
) -> dict[int, Optional[UUID]]:
    """Return a UUID only when a single identity is temporally defensible.

    Cross-boundary sentences are left unresolved here; callers that can emit
    attribution metadata should use :func:`analyze_speaker_attribution`.
    """
    attributions = analyze_speaker_attribution(whisper_segments, diarization_timeline)
    result: dict[int, Optional[UUID]] = {}
    for index, attribution in attributions.items():
        key = attribution.speaker_key
        if key is None or attribution.status != "ATTRIBUTED":
            result[index] = None
            continue
        speaker_id = speaker_uuid_mapping.get(key)
        if speaker_id is None:
            for diarization_segment in diarization_timeline:
                raw_id = getattr(diarization_segment, "raw_speaker_id", None)
                label = getattr(diarization_segment, "speaker", None)
                if (raw_id == key or label == key) and label:
                    speaker_id = speaker_uuid_mapping.get(label)
                    if speaker_id is not None:
                        break
        result[index] = speaker_id
    return result
