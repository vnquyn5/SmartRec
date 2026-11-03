"""Deterministic post-processing for speaker turns."""

import math
from typing import Dict, List, Tuple


def consolidate_speaker_turns(
    raw_turns: List[Tuple[float, float, str]],
    max_gap: float,
    audio_duration: float,
) -> List[Tuple[float, float, str]]:
    """Merge nearby turns for the same speaker without bridging another speaker's turn."""
    if not math.isfinite(max_gap) or max_gap < 0:
        raise ValueError("max_gap must be a finite non-negative number")
    if not math.isfinite(audio_duration) or audio_duration < 0:
        raise ValueError("audio_duration must be a finite non-negative number")

    normalized: List[Tuple[float, float, str]] = []
    for raw_start, raw_end, raw_speaker in raw_turns:
        try:
            start, end = float(raw_start), float(raw_end)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(start) and math.isfinite(end)) or not isinstance(raw_speaker, str) or not raw_speaker:
            continue
        start = max(0.0, min(start, audio_duration))
        end = max(0.0, min(end, audio_duration))
        if end <= start:
            continue
        normalized.append((round(start, 3), round(end, 3), raw_speaker))

    by_speaker: Dict[str, List[Tuple[float, float]]] = {}
    for start, end, speaker in normalized:
        by_speaker.setdefault(speaker, []).append((start, end))

    merged: List[Tuple[float, float, str]] = []
    for speaker, speaker_turns in by_speaker.items():
        speaker_turns.sort()
        current_start, current_end = speaker_turns[0]
        for start, end in speaker_turns[1:]:
            gap = start - current_end
            blocked_by_other_speaker = gap > 0 and any(
                other_speaker != speaker and other_start < start and other_end > current_end
                for other_start, other_end, other_speaker in normalized
            )
            if gap <= max_gap and not blocked_by_other_speaker:
                current_end = max(current_end, end)
            else:
                merged.append((current_start, current_end, speaker))
                current_start, current_end = start, end
        merged.append((current_start, current_end, speaker))
    return sorted(merged, key=lambda turn: (turn[0], turn[1], turn[2]))
