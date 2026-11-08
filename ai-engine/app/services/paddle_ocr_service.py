import sys
import logging
"""PaddleOCR service for SmartRec meeting keyframes."""

import json
import os
import uuid
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.path_security import get_workspace_root
from app.services.artifact_provenance import capture_local_source, verify_local_source

logger = logging.getLogger("smartrec.paddle_ocr")


class PaddleOCRService:
    """Detect and recognize Vietnamese text in keyframe images."""

    def __init__(
        self,
        recognition_model_dir: str | Path,
        device: str = "cpu",
        detection_model_dir: str | Path | None = None,
    ) -> None:
        model_dir = Path(recognition_model_dir).resolve()

        if not model_dir.is_dir():
            raise FileNotFoundError(
                f"OCR recognition model directory not found: {model_dir}"
            )

        for filename in (
            "inference.json",
            "inference.pdiparams",
            "inference.yml",
        ):
            if not (model_dir / filename).is_file():
                raise FileNotFoundError(
                    f"Missing OCR model artifact: {filename}"
                )


        # Resolve an optional local detection model directory.
        # Explicit constructor arguments take precedence over settings.
        configured_detection_dir = (
            detection_model_dir
            if detection_model_dir is not None
            else settings.ocr_detection_model_dir
        )

        resolved_detection_dir = None

        if configured_detection_dir is not None:
            resolved_detection_dir = (
                Path(configured_detection_dir)
                .expanduser()
                .resolve()
            )

            if not resolved_detection_dir.is_dir():
                raise FileNotFoundError(
                    "OCR detection model directory not found: "
                    f"{resolved_detection_dir}"
                )


        # Lazy import to avoid initializing OCR dependencies
        # when unrelated AI Engine services are imported.
        from paddleocr import PaddleOCR

        paddle_options = {
            "device": device,
            "text_detection_model_name": "PP-OCRv6_medium_det",
            "text_recognition_model_name": "PP-OCRv6_medium_rec",
            "text_recognition_model_dir": str(model_dir),
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        }

        # Apply CPU-specific settings only for CPU inference.
        # Do not impose CPU backend options on CUDA inference.
        if device.strip().lower() == "cpu":
            paddle_options.update(
                enable_mkldnn=settings.ocr_enable_mkldnn,
                cpu_threads=settings.ocr_cpu_threads,
            )

        # Use local detection weights when configured.
        # This avoids downloading the detection model at runtime.
        if resolved_detection_dir is not None:
            paddle_options["text_detection_model_dir"] = str(
                resolved_detection_dir
            )

        self._ocr = PaddleOCR(**paddle_options)
        logger.info(
            "PaddleOCR initialized: device=%s detection_model=%s recognition_model=%s",
            device.strip().lower(),
            resolved_detection_dir.name if resolved_detection_dir else "default",
            model_dir.name,
        )


    @staticmethod
    def _validate_keyframe_path(image_path: str | Path) -> Path:
        """Accept only existing JPEG keyframes inside SmartRec workspace."""
        workspace = get_workspace_root().resolve()
        requested = Path(image_path)

        # Check each original path component before resolving.
        # Otherwise, intermediate directory symlinks are hidden.
        absolute = (
            Path.cwd() / requested
            if not requested.is_absolute()
            else requested
        )

        # macOS maps the system /tmp directory to /private/tmp.
        # Normalize only this trusted system alias, preserving all
        # other path components for intermediate symlink checks.
        if sys.platform == "darwin" and absolute.parts[:2] == ("/", "tmp"):
            absolute = Path("/private/tmp").joinpath(
                *absolute.parts[2:]
            )

        try:
            relative = absolute.relative_to(workspace)
        except ValueError as exc:
            raise PermissionError(
                "Keyframe must be inside SmartRec workspace."
            ) from exc

        current = workspace

        for part in relative.parts:
            if part in {".", ".."}:
                raise PermissionError(
                    "Unsafe keyframe path component."
                )

            current = current / part

            if current.is_symlink():
                raise PermissionError(
                    "Keyframe path contains a symlink."
                )

        resolved = absolute.resolve(strict=True)

        if workspace not in resolved.parents:
            raise PermissionError(
                "Keyframe must be inside SmartRec workspace."
            )

        if not resolved.is_file():
            raise ValueError("Keyframe path is not a regular file.")

        if resolved.suffix.lower() not in {".jpg", ".jpeg"}:
            raise ValueError("Unsupported keyframe image format.")

        if resolved.stat().st_size == 0:
            raise ValueError("Keyframe image is empty.")

        return resolved

    def recognize_image(
        self,
        image_path: str | Path,
    ) -> list[dict[str, Any]]:
        """Return raw OCR detections from a single keyframe."""
        validated_path = self._validate_keyframe_path(image_path)

        # Verify that the JPEG can be decoded before OCR inference.
        # Invalid image data must be classified as OCR_IMAGE_ERROR.
        import cv2
        import math

        image = cv2.imread(str(validated_path))

        if image is None or image.size == 0:
            raise ValueError(
                "Keyframe image cannot be decoded."
            )

        results = self._ocr.predict(input=image)
        detections: list[dict[str, Any]] = []


        for result in results:
            payload = result.json

            if not isinstance(payload, dict):
                raise RuntimeError(
                    "Invalid PaddleOCR output payload."
                )

            data = payload.get("res", payload)

            if not isinstance(data, dict):
                raise RuntimeError(
                    "Invalid PaddleOCR recognition data."
                )

            required_fields = (
                "rec_texts",
                "rec_scores",
                "rec_boxes",
            )

            if any(
                field not in data
                for field in required_fields
            ):
                raise RuntimeError(
                    "Missing required PaddleOCR recognition fields."
                )

            texts = data["rec_texts"]
            scores = data["rec_scores"]
            boxes = data["rec_boxes"]

            # Empty lists are valid when no text is detected.
            # Missing fields or malformed collections are not.
            if any(
                not isinstance(values, (list, tuple))
                and not (
                    hasattr(values, "shape")
                    and hasattr(values, "__len__")
                    and hasattr(values, "__iter__")
                )
                for values in (texts, scores, boxes)
            ):
                raise RuntimeError(
                    "Invalid PaddleOCR recognition collections."
                )

            if not (
                len(texts) == len(scores) == len(boxes)
            ):
                raise RuntimeError(
                    "Inconsistent PaddleOCR recognition output."
                )


            for text, confidence, box in zip(
                texts, scores, boxes
            ):
                # Validate recognized text.
                if not isinstance(text, str):
                    raise RuntimeError(
                        "Invalid PaddleOCR text output."
                    )

                # Validate confidence before adding the detection.
                try:
                    score = float(confidence)
                except (TypeError, ValueError, OverflowError) as exc:
                    raise RuntimeError(
                        "Invalid PaddleOCR confidence."
                    ) from exc

                if (
                    isinstance(confidence, bool)
                    or not math.isfinite(score)
                    or not 0.0 <= score <= 1.0
                ):
                    raise RuntimeError(
                        "PaddleOCR confidence must be finite "
                        "and between 0 and 1."
                    )

                # Validate bounding box structure and coordinates.
                try:
                    coordinates = (
                        box.tolist()
                        if hasattr(box, "tolist")
                        else list(box)
                    )

                    if len(coordinates) != 4:
                        raise ValueError(
                            "Bounding box requires four coordinates."
                        )

                    if any(
                        isinstance(value, bool)
                        for value in coordinates
                    ):
                        raise ValueError(
                            "Boolean bounding box coordinate."
                        )

                    numeric_coordinates = [
                        float(value)
                        for value in coordinates
                    ]

                except (TypeError, ValueError, OverflowError) as exc:
                    raise RuntimeError(
                        "Invalid PaddleOCR bounding box."
                    ) from exc

                if not all(
                    math.isfinite(value)
                    for value in numeric_coordinates
                ):
                    raise RuntimeError(
                        "PaddleOCR bounding box contains "
                        "non-finite coordinates."
                    )

                x1, y1, x2, y2 = [
                    int(value)
                    for value in numeric_coordinates
                ]

                if x2 <= x1 or y2 <= y1:
                    raise RuntimeError(
                        "PaddleOCR bounding box has "
                        "invalid dimensions."
                    )

                detections.append(
                    {
                        "text": text,
                        "confidence": score,
                        "bounding_box": [x1, y1, x2, y2],
                    }
                )

        return detections


    @classmethod
    def load_keyframe_manifest(
        cls,
        output_dir: str | Path,
    ) -> tuple[dict[str, Any], list[Path]]:
        """Read one published keyframe manifest and validate its JPEG paths."""
        workspace = get_workspace_root().resolve()
        output = Path(output_dir)

        def safe_file(path: Path, root: Path) -> Path:
            if any(part in {".", ".."} for part in path.parts):
                raise ValueError("Artifact path contains unsafe segments.")

            # Check original path components before resolving symlinks.
            # Resolving first would hide intermediate symlink components.
            try:
                relative = path.relative_to(root)
            except ValueError as exc:
                raise PermissionError(
                    "Artifact escapes its allowed directory."
                ) from exc

            current = root

            for part in relative.parts:
                current = current / part

                if current.is_symlink():
                    raise PermissionError(
                        "Artifact symlink is not allowed."
                    )

            resolved = path.resolve(strict=True)

            if root not in resolved.parents:
                raise PermissionError(
                    "Artifact escapes its allowed directory."
                )

            if not resolved.is_file():
                raise ValueError(
                    "Artifact is not a regular file."
                )

            return resolved

        if output.is_symlink():
            raise PermissionError("Output directory symlink is not allowed.")

        output = output.resolve(strict=True)

        if workspace not in output.parents or not output.is_dir():
            raise PermissionError("Invalid keyframe output directory.")

        pointer_path = safe_file(output / "current.json", output)

        with pointer_path.open("r", encoding="utf-8") as file:
            pointer = json.load(file)

        if (
            not isinstance(pointer, dict)
            or pointer.get("schema_version") != "1.0"
        ):
            raise ValueError("Unsupported keyframe pointer schema.")

        run_id = pointer.get("run_id")
        manifest_relative = pointer.get("manifest_path")

        if (
            not isinstance(run_id, str)
            or not run_id.startswith("run_")
            or not isinstance(manifest_relative, str)
        ):
            raise ValueError("Invalid keyframe pointer.")

        expected_manifest = f"versions/{run_id}/manifest.json"

        if manifest_relative != expected_manifest:
            raise ValueError("Unexpected manifest path in pointer.")

        manifest_path = safe_file(
            output / manifest_relative,
            output,
        )

        with manifest_path.open("r", encoding="utf-8") as file:
            manifest = json.load(file)

        if (
            not isinstance(manifest, dict)
            or manifest.get("schema_version") != "1.1"
            or not isinstance(manifest.get("keyframes"), list)
        ):
            raise ValueError("Unsupported keyframe manifest schema.")

        keyframes = manifest["keyframes"]

        if manifest.get("total_keyframes") != len(keyframes):
            raise ValueError("Keyframe count does not match manifest.")

        image_paths: list[Path] = []
        slide_ids: set[str] = set()

        for item in keyframes:
            if not isinstance(item, dict):
                raise ValueError("Invalid keyframe entry.")

            slide_id = item.get("slide_id")
            image_name = item.get("image_path")
            timestamp = item.get("timestamp_ms")
            occurrences = item.get("occurrences_ms")

            if (
                not isinstance(slide_id, str)
                or not slide_id
                or slide_id in slide_ids
                or not isinstance(image_name, str)
                or not image_name.endswith(".jpg")
                or Path(image_name).name != image_name
                or type(timestamp) is not int
                or timestamp < 0
                or not isinstance(occurrences, list)
                or not occurrences
                or any(
                    type(value) is not int or value < 0
                    for value in occurrences
                )
            ):
                raise ValueError("Invalid keyframe metadata.")

            slide_ids.add(slide_id)

            # Validate containment without requiring the image to exist.
            # Missing or corrupted images are handled per slide by OCR.
            image_path = manifest_path.parent / image_name

            if image_path.is_symlink():
                raise PermissionError("Keyframe symlink is not allowed.")

            resolved_image = image_path.resolve(strict=False)

            if manifest_path.parent not in resolved_image.parents:
                raise PermissionError(
                    "Keyframe escapes its manifest directory."
                )

            image_paths.append(resolved_image)

        # Preserve the run identity selected by this pointer read.
        # Do not reread current.json after OCR processing.
        manifest["_keyframe_run_id"] = run_id

        return manifest, image_paths

    def process_keyframes(
        self,
        output_dir: str | Path,
        *,
        meeting_id: str | None = None,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        """Process all keyframes from one published manifest."""
        if (meeting_id is None) != (job_id is None):
            raise ValueError("Local provenance requires both meeting_id and job_id")
        manifest, image_paths = self.load_keyframe_manifest(
            output_dir
        )

        slides: list[dict[str, Any]] = []

        for item, image_path in zip(
            manifest["keyframes"],
            image_paths,
        ):
            slide_result: dict[str, Any] = {
                "slide_id": item["slide_id"],
                "timestamp_ms": item["timestamp_ms"],
                "timestamp_basis": item.get("timestamp_basis", "sample_target"),
                "occurrences_ms": list(
                    item["occurrences_ms"]
                ),
                "status": "FAILED",
                "text": "",
                "detections": [],
                "error": None,
                "image_source": None,
            }

            try:
                image_source = None
                if meeting_id is not None:
                    image_source = capture_local_source(
                        get_workspace_root(), image_path, str(meeting_id), str(job_id)
                    )
                detections = self.recognize_image(
                    image_path
                )
                if image_source is not None:
                    verify_local_source(get_workspace_root(), image_source, str(meeting_id), str(job_id))
                    slide_result["image_source"] = image_source.to_dict()

                slide_result["detections"] = detections
                slide_result["text"] = "\n".join(
                    detection["text"]
                    for detection in detections
                )

                slide_result["status"] = (
                    "SUCCESS"
                    if detections
                    else "NO_TEXT_DETECTED"
                )

            except (
                FileNotFoundError,
                ValueError,
                PermissionError,
                OSError,
            ) as exc:
                slide_result["error"] = {
                    "code": "OCR_IMAGE_ERROR",
                    "message": str(exc),
                }

            except Exception as exc:
                slide_result["error"] = {
                    "code": "OCR_INFERENCE_FAILED",
                    "message": type(exc).__name__,
                }

            slides.append(slide_result)

        successful = sum(
            slide["status"] == "SUCCESS"
            for slide in slides
        )

        failed = sum(
            slide["status"] == "FAILED"
            for slide in slides
        )

        keyframe_run_id = manifest["_keyframe_run_id"]

        return {
            "schema_version": "1.0",
            "keyframe_run_id": keyframe_run_id,
            "source_video": manifest["source_video"],
            "total_slides": len(slides),
            "successful_slides": successful,
            "failed_slides": failed,
            "slides": slides,
        }

    @staticmethod
    def save_ocr_result(
        result: dict[str, Any],
        output_dir: str | Path,
    ) -> Path:
        """Atomically publish OCR JSON inside SmartRec workspace."""
        workspace = get_workspace_root().resolve()
        output = Path(output_dir)

        if output.is_symlink():
            raise PermissionError(
                "OCR output directory symlink is not allowed."
            )

        output = output.resolve(strict=True)

        if (
            workspace not in output.parents
            or not output.is_dir()
        ):
            raise PermissionError(
                "OCR output directory must be inside SmartRec workspace."
            )

        target = output / "ocr_result.json"

        if target.is_symlink():
            raise PermissionError(
                "OCR result symlink is not allowed."
            )

        # Serialize before writing to avoid publishing invalid JSON.
        payload = json.dumps(
            result,
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        )

        temporary = output / f".ocr_{uuid.uuid4().hex}.tmp"

        try:
            with temporary.open("x", encoding="utf-8") as file:
                file.write(payload)
                file.flush()
                os.fsync(file.fileno())

            os.replace(temporary, target)

        finally:
            if temporary.exists():
                temporary.unlink()

        return target
