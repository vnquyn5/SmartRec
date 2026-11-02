"""Post-processing utilities for SmartRec OCR results."""

import math
import re
import unicodedata
import json
import os
import uuid
from copy import deepcopy
from pathlib import Path
from app.core.path_security import get_workspace_root


class OCRPostProcessor:
    """Normalize OCR output while preserving its original meaning."""

    @staticmethod
    def normalize_text(text: str) -> str:
        """Normalize Unicode and whitespace without guessing corrections."""
        if not isinstance(text, str):
            raise TypeError("OCR text must be a string.")

        # Preserve Vietnamese diacritics using canonical composition.
        normalized = unicodedata.normalize("NFC", text)

        # Remove non-semantic invisible characters.
        normalized = normalized.replace("\ufeff", "")
        normalized = normalized.replace("\u200b", "")

        # Replace control characters with spaces instead of joining words.
        normalized = "".join(
            " " if unicodedata.category(char) == "Cc" else char
            for char in normalized
        )

        # Collapse whitespace; each OCR detection is treated as one block.
        normalized = re.sub(r"\s+", " ", normalized)

        return normalized.strip()

    @staticmethod
    def sort_detections(
        detections: list[dict],
    ) -> list[dict]:
        """Sort single-column OCR detections into reading order."""
        if not isinstance(detections, list):
            raise TypeError("Detections must be a list.")

        validated = []

        for detection in detections:
            if not isinstance(detection, dict):
                raise TypeError("Each detection must be a dictionary.")

            box = detection.get("bounding_box")

            if (
                not isinstance(box, (list, tuple))
                or len(box) != 4
                or any(
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not __import__("math").isfinite(value)
                    for value in box
                )
            ):
                raise ValueError("Invalid OCR bounding box.")

            x1, y1, x2, y2 = box

            if x2 <= x1 or y2 <= y1:
                raise ValueError("OCR bounding box has invalid dimensions.")

            validated.append({
                "detection": detection,
                "x": x1,
                "y": (y1 + y2) / 2,
                "height": y2 - y1,
            })

        # Group text regions whose vertical centers belong
        # to the same visual line.
        validated.sort(key=lambda item: (item["y"], item["x"]))

        rows = []

        for item in validated:
            matching_row = None

            for row in rows:
                tolerance = max(
                    3.0,
                    min(row["height"], item["height"]) * 0.4,
                )

                if abs(item["y"] - row["center"]) <= tolerance:
                    matching_row = row
                    break

            if matching_row is None:
                rows.append({
                    "center": item["y"],
                    "height": item["height"],
                    "items": [item],
                })
            else:
                matching_row["items"].append(item)

                centers = [
                    entry["y"]
                    for entry in matching_row["items"]
                ]
                matching_row["center"] = sum(centers) / len(centers)

        rows.sort(key=lambda row: row["center"])

        ordered = []

        for row in rows:
            row["items"].sort(key=lambda item: item["x"])

            ordered.extend(
                item["detection"]
                for item in row["items"]
            )

        return ordered

    @staticmethod
    def detect_two_columns(
        detections: list[dict],
    ) -> bool:
        """
        Detect a separated two-column layout using OCR geometry.

        Full-width titles and spanning text are excluded from
        column evidence rather than invalidating the whole layout.

        This method detects geometry only. It does not decide
        whether the layout represents prose columns or a table.
        """
        ordered = OCRPostProcessor.sort_detections(detections)

        if len(ordered) < 6:
            return False

        boxes = [
            item["bounding_box"]
            for item in ordered
        ]

        page_left = min(box[0] for box in boxes)
        page_right = max(box[2] for box in boxes)
        page_width = page_right - page_left

        if page_width <= 0:
            return False

        # Determine a preliminary separator between the
        # left and right halves of the content.
        separator = (page_left + page_right) / 2.0

        left = []
        right = []

        for box in boxes:
            x1, y1, x2, y2 = box

            if x2 <= separator:
                left.append(box)
            elif x1 >= separator:
                right.append(box)

            # Boxes crossing the separator are not used as
            # evidence for either column. These may be titles,
            # wide paragraphs or other spanning regions.

        # Require meaningful content on both sides.
        if len(left) < 3 or len(right) < 3:
            return False

        left_edge = max(box[2] for box in left)
        right_edge = min(box[0] for box in right)

        gap = right_edge - left_edge

        # Real presentation slides can have narrow gutters.
        if gap < page_width * 0.015:
            return False

        left_top = min(box[1] for box in left)
        left_bottom = max(box[3] for box in left)

        right_top = min(box[1] for box in right)
        right_bottom = max(box[3] for box in right)

        vertical_overlap = (
            min(left_bottom, right_bottom)
            - max(left_top, right_top)
        )

        if vertical_overlap <= 0:
            return False

        return True

    @staticmethod
    def classify_layout(
        detections: list[dict],
    ) -> str:
        """Classify OCR layout without guessing table semantics.

        SINGLE_COLUMN: no separated two-column pattern detected.
        AMBIGUOUS: two horizontal groups may represent text columns
                   or a table; preserve row reading order.
        """
        has_two_column_pattern = (
            OCRPostProcessor.detect_two_columns(detections)
        )

        if has_two_column_pattern:
            return "AMBIGUOUS"

        return "SINGLE_COLUMN"

    @staticmethod
    def group_into_rows(
        detections: list[dict],
    ) -> list[list[dict]]:
        """Group OCR detections by visual rows.

        This method groups geometry only. It does not assert
        that the detections represent a table.
        """
        ordered = OCRPostProcessor.sort_detections(detections)

        rows: list[dict] = []

        for detection in ordered:
            x1, y1, x2, y2 = detection["bounding_box"]
            center_y = (y1 + y2) / 2
            height = y2 - y1

            matching_row = None

            for row in rows:
                tolerance = max(
                    3.0,
                    min(row["height"], height) * 0.4,
                )

                if abs(center_y - row["center"]) <= tolerance:
                    matching_row = row
                    break

            if matching_row is None:
                rows.append({
                    "center": center_y,
                    "height": height,
                    "items": [detection],
                })
            else:
                matching_row["items"].append(detection)

                centers = [
                    (
                        item["bounding_box"][1]
                        + item["bounding_box"][3]
                    ) / 2
                    for item in matching_row["items"]
                ]

                matching_row["center"] = (
                    sum(centers) / len(centers)
                )

        rows.sort(key=lambda row: row["center"])

        result = []

        for row in rows:
            result.append(
                sorted(
                    row["items"],
                    key=lambda item: item["bounding_box"][0],
                )
            )

        return result

    @staticmethod
    def reconstruct_table(
        detections: list[dict],
    ) -> dict | None:
        """Reconstruct a regular table from OCR bounding boxes.

        Geometry-only reconstruction. The result is a table
        candidate, not proof of table semantics.
        """
        rows = OCRPostProcessor.group_into_rows(detections)

        if len(rows) < 2:
            return None

        # A table may have one or more full-width titles above
        # its regular grid. Exclude only those leading titles
        # from table reconstruction, without removing detections
        # from the original OCR output.
        if len(rows) >= 3:
            boxes = [
                detection["bounding_box"]
                for row in rows
                for detection in row
            ]

            page_left = min(box[0] for box in boxes)
            page_right = max(box[2] for box in boxes)
            separator = (page_left + page_right) / 2.0

            first_body_row = 0

            # Always leave at least two rows for a possible table.
            while first_body_row < len(rows) - 2:
                row = rows[first_body_row]

                if len(row) != 1:
                    break

                box = row[0]["bounding_box"]

                # Only a leading region spanning the horizontal
                # separator can be treated as a table title.
                if not (
                    box[0] < separator < box[2]
                ):
                    break

                first_body_row += 1

            if first_body_row > 0:
                rows = rows[first_body_row:]

        column_count = len(rows[0])

        if column_count < 2:
            return None

        if any(len(row) != column_count for row in rows):
            return None

        # Compute reference centers for each proposed column.
        column_centers = []

        for col in range(column_count):
            centers = [
                (
                    row[col]["bounding_box"][0]
                    + row[col]["bounding_box"][2]
                ) / 2
                for row in rows
            ]
            column_centers.append(
                sum(centers) / len(centers)
            )

        all_boxes = [
            detection["bounding_box"]
            for row in rows
            for detection in row
        ]

        page_width = (
            max(box[2] for box in all_boxes)
            - min(box[0] for box in all_boxes)
        )

        if page_width <= 0:
            return None

        # Each cell must remain sufficiently close to its
        # corresponding column's reference center.
        max_deviation = page_width * 0.12

        for row in rows:
            for col, detection in enumerate(row):
                box = detection["bounding_box"]
                center = (box[0] + box[2]) / 2

                if abs(center - column_centers[col]) > max_deviation:
                    return None

        cells = []

        for row in rows:
            cells.append([
                {
                    "text": OCRPostProcessor.normalize_text(
                        detection["text"]
                    ),
                    "confidence": detection["confidence"],
                    "bounding_box": list(
                        detection["bounding_box"]
                    ),
                }
                for detection in row
            ])

        return {
            "type": "TABLE_CANDIDATE",
            "row_count": len(cells),
            "column_count": column_count,
            "rows": cells,
        }

    @staticmethod
    def order_clear_two_column_prose(
        detections: list[dict],
    ) -> list[dict] | None:
        """
        Return column-wise reading order only for a clearly
        separated two-column prose layout.

        Return None when the layout is insufficiently certain.
        Preserve every original detection without modifying it.
        """
        ordered = OCRPostProcessor.sort_detections(detections)

        if not OCRPostProcessor.detect_two_columns(ordered):
            return None

        boxes = [
            item["bounding_box"]
            for item in ordered
        ]

        page_left = min(box[0] for box in boxes)
        page_right = max(box[2] for box in boxes)
        separator = (page_left + page_right) / 2.0

        left = []
        right = []
        spanning = []

        for item in ordered:
            x1, y1, x2, y2 = item["bounding_box"]

            if x2 <= separator:
                left.append(item)
            elif x1 >= separator:
                right.append(item)
            else:
                spanning.append(item)

        # Require sufficient evidence for two independent
        # text regions, not isolated labels or decorations.
        if len(left) < 7 or len(right) < 7:
            return None

        first_column_top = min(
            min(item["bounding_box"][1] for item in left),
            min(item["bounding_box"][1] for item in right),
        )

        # Spanning text is allowed only before both columns.
        # Mixed layouts retain their existing reading order.
        if any(
            item["bounding_box"][3] > first_column_top
            for item in spanning
        ):
            return None

        return (
            OCRPostProcessor.sort_detections(spanning)
            + OCRPostProcessor.sort_detections(left)
            + OCRPostProcessor.sort_detections(right)
        )

    @staticmethod
    def process_ocr_result(
        ocr_result: dict,
    ) -> dict:
        """Post-process OCR results while retaining source evidence."""
        if not isinstance(ocr_result, dict):
            raise TypeError("OCR result must be a dictionary.")

        if ocr_result.get("schema_version") != "1.0":
            raise ValueError("Unsupported OCR result schema.")

        run_id = ocr_result.get("keyframe_run_id")

        if not isinstance(run_id, str) or not run_id.strip():
            raise ValueError("Invalid or missing keyframe_run_id.")

        slides_input = ocr_result.get("slides")

        if not isinstance(slides_input, list):
            raise ValueError("OCR result must contain a slides list.")

        processed_slides = []

        for slide in slides_input:
            if not isinstance(slide, dict):
                raise ValueError("Invalid OCR slide.")

            status = slide.get("status")

            if status not in (
                "SUCCESS",
                "FAILED",
                "NO_TEXT_DETECTED",
            ):
                raise ValueError("Invalid OCR slide status.")

            timestamp_ms = slide.get("timestamp_ms")

            if (
                type(timestamp_ms) is not int
                or timestamp_ms < 0
            ):
                raise ValueError("Invalid OCR slide timestamp_ms.")

            occurrences_ms = slide.get("occurrences_ms")

            if (
                not isinstance(occurrences_ms, list)
                or any(
                    type(value) is not int or value < 0
                    for value in occurrences_ms
                )
            ):
                raise ValueError("Invalid OCR slide occurrences_ms.")

            raw_text = slide.get("text", "")

            if not isinstance(raw_text, str):
                raise ValueError("Invalid OCR slide text.")

            detections = slide.get("detections", [])

            if not isinstance(detections, list):
                raise ValueError("Invalid OCR detections.")

            for detection in detections:
                if not isinstance(detection, dict):
                    raise ValueError("Invalid OCR detection.")

                confidence = detection.get("confidence")

                if (
                    isinstance(confidence, bool)
                    or not isinstance(confidence, (int, float))
                    or not math.isfinite(confidence)
                    or not 0 <= confidence <= 1
                ):
                    raise ValueError(
                        "OCR detection confidence must be between 0 and 1."
                    )

            normalized_detections = []
            normalized_text = ""
            layout_type = "SINGLE_COLUMN"
            table_candidate = None

            if status == "SUCCESS":
                ordered = OCRPostProcessor.sort_detections(
                    detections
                )

                layout_type = OCRPostProcessor.classify_layout(
                    detections
                )

                # Table detection must not depend on the
                # minimum detection count for two-column prose.
                # Small tables (e.g. 2x2) may contain fewer
                # than six OCR detections.
                table_candidate = (
                    OCRPostProcessor.reconstruct_table(
                        detections
                    )
                )

                # Reorder prose only when a two-column pattern
                # exists and no regular table was detected.
                if (
                    layout_type == "AMBIGUOUS"
                    and table_candidate is None
                ):
                    column_order = (
                        OCRPostProcessor.order_clear_two_column_prose(
                            detections
                        )
                    )

                    if column_order is not None:
                        ordered = column_order

                for detection in ordered:
                    if not isinstance(
                        detection.get("text"), str
                    ):
                        raise ValueError(
                            "Invalid OCR detection text."
                        )

                    normalized_detections.append({
                        **detection,
                        "normalized_text":
                            OCRPostProcessor.normalize_text(
                                detection["text"]
                            ),
                    })

                normalized_text = "\n".join(
                    detection["normalized_text"]
                    for detection in normalized_detections
                    if detection["normalized_text"]
                )

            processed_slides.append({
                "slide_id": slide.get("slide_id"),
                "timestamp_ms": slide.get("timestamp_ms"),
                "timestamp_basis": slide.get("timestamp_basis", "sample_target"),
                "image_source": deepcopy(slide.get("image_source")),
                "occurrences_ms": list(
                    slide.get("occurrences_ms", [])
                ),
                "status": status,
                "raw_text": raw_text,
                "normalized_text": normalized_text,
                "layout_type": layout_type,
                "detections": (
                    normalized_detections
                    if status == "SUCCESS"
                    else [dict(detection) for detection in detections]
                ),
                "table_candidate": table_candidate,
                "error": slide.get("error"),
            })

        return {
            "schema_version": "1.0",
            "keyframe_run_id": ocr_result.get(
                "keyframe_run_id"
            ),
            "source_video": ocr_result.get("source_video"),
            "total_slides": len(processed_slides),
            "successful_slides": sum(
                slide["status"] == "SUCCESS"
                for slide in processed_slides
            ),
            "failed_slides": sum(
                slide["status"] == "FAILED"
                for slide in processed_slides
            ),
            "slides": processed_slides,
        }

    @staticmethod
    def save_postprocessed_result(
        result: dict,
        output_dir: str | Path,
    ) -> Path:
        """Atomically save postprocessed OCR JSON."""
        if not isinstance(result, dict):
            raise TypeError(
                "Postprocessed OCR result must be a dictionary."
            )

        workspace = get_workspace_root().resolve()
        output = Path(output_dir)

        # Reject symlinks in every path component before resolve().
        # This also covers symlinks pointing to locations inside
        # the SmartRec workspace.
        absolute_output = Path(os.path.abspath(output))

        for component in (
            absolute_output,
            *absolute_output.parents,
        ):
            if component.is_symlink():
                raise PermissionError(
                    "OCR output path contains a symlink."
                )

        output = absolute_output.resolve(strict=True)

        if workspace not in output.parents or not output.is_dir():
            raise PermissionError(
                "OCR output directory must be inside SmartRec workspace."
            )

        target = output / "ocr_postprocessed.json"

        if target.is_symlink():
            raise PermissionError(
                "Postprocessed OCR result symlink is not allowed."
            )

        payload = json.dumps(
            result,
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        )

        temporary = output / f".ocr_postprocessed_{uuid.uuid4().hex}.tmp"

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
