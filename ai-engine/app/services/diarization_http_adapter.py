"""HTTP adapter for SmartRec's native macOS Pyannote service.

Add as ai-engine/app/services/diarization_http_adapter.py. It does not change
existing SmartRec imports by itself. Configure the service URL and token in
Celery's environment only after testing the adapter.

Native API contracts:
- POST /diarize: multipart field audio; returns {status, segments:[{start,end,speaker}]}
- POST /embeddings: multipart audio + speaker_segments (JSON string); returns
  {status, embeddings:{speaker:[...256 floats...]}}
"""

import json
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import requests
from pyannote.core import Annotation, Segment


class DiarizationHTTPError(RuntimeError):
    """Failure contacting or decoding the native Pyannote HTTP service."""


def _get_field(item: Any, *names: str) -> Any:
    for name in names:
        if isinstance(item, dict):
            value = item.get(name)
        else:
            value = getattr(item, name, None)
        if value is not None:
            return value
    return None


class DiarizationHTTPAdapter:
    """Drop-in alternative to DiarizationRuntimeManager for the used methods."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        timeout_seconds: int = 900,
    ) -> None:
        self.base_url = (
            base_url or os.getenv("PYANNOTE_NATIVE_URL", "http://host.docker.internal:8086")
        ).rstrip("/")
        self.token = token if token is not None else os.getenv("PYANNOTE_NATIVE_TOKEN", "")
        self.timeout_seconds = timeout_seconds

    def _post_audio(self, endpoint: str, audio_path: Union[str, Path], data=None) -> dict:
        if not self.token:
            raise DiarizationHTTPError("PYANNOTE_NATIVE_TOKEN is not configured")
        path = Path(audio_path)
        if not path.is_file():
            raise DiarizationHTTPError(f"WAV not found in Celery container: {path}")

        try:
            with path.open("rb") as handle:
                response = requests.post(
                    f"{self.base_url}{endpoint}",
                    headers={"X-SmartRec-Token": self.token},
                    files={"audio": (path.name, handle, "audio/wav")},
                    data=data,
                    timeout=(10, self.timeout_seconds),
                )
            response.raise_for_status()
            payload = response.json()
        except requests.RequestException as exc:
            # Do not log request headers, tokens or raw user audio.
            status = getattr(getattr(exc, "response", None), "status_code", None)
            detail = f"HTTP {status}" if status else type(exc).__name__
            raise DiarizationHTTPError(
                f"Native Pyannote {endpoint} request failed: {detail}"
            ) from exc
        except ValueError as exc:
            raise DiarizationHTTPError("Native Pyannote returned invalid JSON") from exc

        if not isinstance(payload, dict) or payload.get("status") != "SUCCESS":
            raise DiarizationHTTPError("Native Pyannote returned a non-SUCCESS response")
        return payload

    def diarize(self, audio_input: Union[str, Path], **kwargs: Any) -> Annotation:
        if kwargs:
            raise DiarizationHTTPError(
                "Native /diarize does not support extra pyannote inference arguments"
            )
        if not isinstance(audio_input, (str, Path)):
            raise DiarizationHTTPError("Native /diarize requires a WAV file path")

        payload = self._post_audio("/diarize", audio_input)
        turns = payload.get("segments")
        if not isinstance(turns, list):
            raise DiarizationHTTPError("Native /diarize response has no segments list")

        annotation = Annotation(uri=Path(audio_input).stem)
        for index, turn in enumerate(turns):
            if not isinstance(turn, dict):
                raise DiarizationHTTPError("Invalid speaker turn in native response")
            try:
                start, end = float(turn["start"]), float(turn["end"])
                speaker = turn["speaker"]
            except (KeyError, TypeError, ValueError) as exc:
                raise DiarizationHTTPError("Incomplete speaker turn in native response") from exc
            if (
                not (math.isfinite(start) and math.isfinite(end))
                or start < 0
                or end <= start
                or not isinstance(speaker, str)
                or not speaker
            ):
                raise DiarizationHTTPError("Invalid times or speaker in native response")
            annotation[Segment(start, end), str(index)] = speaker
        return annotation

    def extract_speaker_embeddings(
        self,
        audio_path: Union[str, Path],
        speaker_segments: List[Any],
        max_duration_per_speaker: float = 30.0,
    ) -> Dict[str, List[float]]:
        if not speaker_segments:
            return {}
        if max_duration_per_speaker != 30.0:
            raise DiarizationHTTPError("Native /embeddings currently uses a fixed 30s cap")

        turns = []
        for segment in speaker_segments:
            speaker = _get_field(segment, "speaker", "raw_speaker_id")
            start = _get_field(segment, "start_seconds", "start")
            end = _get_field(segment, "end_seconds", "end")
            if speaker is None or start is None or end is None:
                continue
            try:
                start, end = float(start), float(end)
            except (TypeError, ValueError):
                continue
            if not (math.isfinite(start) and math.isfinite(end)) or end <= start:
                continue
            turns.append({"speaker": str(speaker), "start": start, "end": end})

        if not turns:
            return {}
        payload = self._post_audio(
            "/embeddings", audio_path, data={"speaker_segments": json.dumps(turns)}
        )
        vectors = payload.get("embeddings")
        if not isinstance(vectors, dict):
            raise DiarizationHTTPError("Native /embeddings response missing embeddings dict")
        normalized: Dict[str, List[float]] = {}
        for speaker, vector in vectors.items():
            if not isinstance(speaker, str) or not isinstance(vector, list):
                raise DiarizationHTTPError("Invalid native embeddings response")
            try:
                values = [float(value) for value in vector]
            except (ValueError, TypeError) as exc:
                raise DiarizationHTTPError("Embedding contains invalid numeric values") from exc
            if len(values) != 256 or not all(math.isfinite(v) for v in values):
                raise DiarizationHTTPError("Expected a finite 256-dimensional embedding")
            normalized[speaker] = values
        return normalized

    def reset(self) -> None:
        """No-op: the separate macOS process owns and caches the Pyannote model."""
        return None


diarization_runtime = DiarizationHTTPAdapter()
