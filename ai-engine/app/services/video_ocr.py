"""Low-memory video keyframe OCR using FFmpeg and the Tesseract CLI."""

import os
import re
import subprocess
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


class VideoOcrError(RuntimeError):
    pass


def extract_video_ocr(video_path: str, work_dir: str, *, interval_seconds: int = 5, max_frames: int = 80) -> list[dict[str, Any]]:
    """Sample timestamped keyframes and deduplicate repeated OCR text."""
    root = Path(work_dir)
    frames_dir = root / "ocr_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for previous in frames_dir.glob("frame-*.jpg"):
        previous.unlink(missing_ok=True)
    pattern = frames_dir / "frame-%04d.jpg"
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", video_path,
        "-vf", f"fps=1/{max(1, interval_seconds)}", "-frames:v", str(max_frames),
        "-q:v", "4", "-y", str(pattern),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=1800)
    if completed.returncode:
        raise VideoOcrError((completed.stderr or "FFmpeg keyframe extraction failed")[-1200:])

    records = []
    previous_texts: list[str] = []
    for frame in sorted(frames_dir.glob("frame-*.jpg")):
        try:
            index = int(frame.stem.rsplit("-", 1)[1]) - 1
        except ValueError:
            continue
        ocr = subprocess.run(
            ["tesseract", str(frame), "stdout", "-l", "vie+eng", "--psm", "6"],
            capture_output=True, text=True, timeout=90,
        )
        if ocr.returncode:
            raise VideoOcrError((ocr.stderr or "Tesseract OCR failed")[-1200:])
        text = " ".join((ocr.stdout or "").split())
        if not text:
            continue
        normalized = re.sub(r"\W+", "", text.lower())
        if any(SequenceMatcher(None, normalized, old).ratio() >= 0.90 for old in previous_texts):
            continue
        previous_texts.append(normalized)
        records.append({
            "timestampMs": index * max(1, interval_seconds) * 1000,
            "text": text,
            "frame": frame.name,
        })
    return records
