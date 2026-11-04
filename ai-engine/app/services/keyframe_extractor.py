"""
SmartRec - Keyframe Extraction Service.
Trích xuất keyframe đại diện cho các slide trình chiếu trong video cuộc họp.

Module nhận video đã được AI Worker tải về workspace.
Không trực tiếp truy cập MinIO hoặc thay đổi vòng đời của Worker.
"""
import json
import math
import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from skimage.metrics import structural_similarity

from app.core.path_security import (
    get_workspace_root,
    validate_safe_read_path,
)
from app.services.ffmpeg_wrapper import FFmpegWrapper


SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mkv"}

class KeyframeExtractionError(Exception):
    """Lỗi trong quá trình kiểm tra hoặc trích xuất keyframe."""


class KeyframeExtractor:
    """Dịch vụ xử lý và trích xuất keyframe từ video cuộc họp."""

    def __init__(
        self,
        sample_interval_seconds: float = 1.0,
        ssim_threshold: float = 0.85,
        min_sharpness: float = 80.0,
    ):
        if (
            not math.isfinite(sample_interval_seconds)
            or sample_interval_seconds <= 0
        ):
            raise ValueError(
                "sample_interval_seconds phải là số hữu hạn lớn hơn 0."
            )

        if not math.isfinite(ssim_threshold) or not 0 <= ssim_threshold <= 1:
            raise ValueError(
                "ssim_threshold phải nằm trong khoảng [0, 1]."
            )

        if not math.isfinite(min_sharpness) or min_sharpness < 0:
            raise ValueError(
                "min_sharpness phải là số hữu hạn không âm."
            )

        self.sample_interval_seconds = sample_interval_seconds
        self.ssim_threshold = ssim_threshold
        self.min_sharpness = min_sharpness

        self.ffmpeg = FFmpegWrapper()

    def inspect_video(self, video_path: str) -> dict[str, Any]:
        """
        Kiểm tra video đầu vào và trả về metadata cần thiết.

        Video phải:
        - Tồn tại tại đường dẫn được phép đọc.
        - Có định dạng MP4 hoặc MKV.
        - Chứa ít nhất một video stream hợp lệ.
        - Có thời lượng và độ phân giải hợp lệ.
        """
        path = validate_safe_read_path(video_path)

        if path.suffix.lower() not in SUPPORTED_VIDEO_EXTENSIONS:
            raise KeyframeExtractionError(
                f"Định dạng video không hỗ trợ: {path.suffix}"
            )

        metadata = self.ffmpeg.get_media_metadata(str(path))

        video_stream = next(
            (
                stream
                for stream in metadata.get("streams", [])
                if stream.get("codec_type") == "video"
                and stream.get("disposition", {}).get("attached_pic", 0) != 1
            ),
            None,
        )

        if video_stream is None:
            raise KeyframeExtractionError(
                "Media không chứa video stream hợp lệ."
            )

        width = int(video_stream.get("width") or 0)
        height = int(video_stream.get("height") or 0)

        duration = float(
            video_stream.get("duration")
            or metadata.get("format", {}).get("duration")
            or 0
        )

        if width <= 0 or height <= 0:
            raise KeyframeExtractionError(
                "Độ phân giải video không hợp lệ."
            )

        if not math.isfinite(duration) or duration <= 0:
            raise KeyframeExtractionError(
                "Thời lượng video không hợp lệ."
            )

        fps_raw = video_stream.get("avg_frame_rate", "0/1")

        try:
            numerator, denominator = map(int, fps_raw.split("/"))
            fps = numerator / denominator if denominator > 0 else 0.0
        except (ValueError, AttributeError):
            fps = 0.0

        return {
            "source_video": path.name,
            "video_path": str(path),
            "duration_seconds": round(duration, 3),
            "width": width,
            "height": height,
            "fps": round(fps, 3),
            "sample_interval_seconds": self.sample_interval_seconds,
        }

    @staticmethod
    def calculate_sharpness(frame: np.ndarray) -> float:
        """Đánh giá độ sắc nét bằng phương sai Laplacian."""
        if frame is None or frame.size == 0:
            raise KeyframeExtractionError("Frame rỗng hoặc không hợp lệ.")

        if frame.ndim == 3 and frame.shape[2] == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        elif frame.ndim == 2:
            gray = frame
        else:
            raise KeyframeExtractionError("Định dạng frame không hỗ trợ.")

        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    def sample_frames(
        self,
        video_path: str,
        duration_seconds: float,
    ):
        """
        Đọc từng frame theo khoảng thời gian cấu hình.

        Yield (timestamp_seconds, frame).

        Phân biệt:
        - Kết thúc hợp lệ gần cuối video.
        - Lỗi giải mã xảy ra trước khi video kết thúc.

        Không lưu toàn bộ video trong bộ nhớ.
        """
        if not math.isfinite(duration_seconds) or duration_seconds <= 0:
            raise ValueError(
                "duration_seconds phải là số hữu hạn lớn hơn 0."
            )

        capture = cv2.VideoCapture(str(video_path))

        if not capture.isOpened():
            capture.release()
            raise KeyframeExtractionError(
                "Không thể mở video bằng OpenCV."
            )

        decoded_count = 0

        # Cho phép sai số rất nhỏ ở cuối video do metadata
        # và timestamp của decoder không hoàn toàn khớp.
        eof_tolerance = min(
            0.25,
            self.sample_interval_seconds * 0.1,
        )

        try:
            timestamp = 0.0

            while timestamp < duration_seconds:
                capture.set(
                    cv2.CAP_PROP_POS_MSEC,
                    timestamp * 1000,
                )

                success, frame = capture.read()

                if not success or frame is None:
                    remaining = duration_seconds - timestamp

                    # Chỉ chấp nhận EOF nếu đã đọc được ít nhất
                    # một frame và đang ở rất gần cuối video.
                    if (
                        decoded_count > 0
                        and (
                            remaining <= eof_tolerance
                            or math.isclose(
                                remaining,
                                eof_tolerance,
                                rel_tol=0.0,
                                abs_tol=1e-9,
                            )
                        )
                    ):
                        break

                    raise KeyframeExtractionError(
                        "Giải mã video thất bại trước khi kết thúc. "
                        f"Timestamp: {timestamp:.3f}s, "
                        f"Duration: {duration_seconds:.3f}s, "
                        f"Remaining: {remaining:.3f}s."
                    )

                decoded_count += 1

                yield round(timestamp, 3), frame

                timestamp += self.sample_interval_seconds

        finally:
            capture.release()

    @staticmethod
    def calculate_ssim(
        frame_a: np.ndarray,
        frame_b: np.ndarray,
    ) -> float:
        """
        Tính SSIM giữa hai frame.

        Ảnh được chuyển sang grayscale và thu nhỏ để giảm
        chi phí tính toán trên video có độ phân giải lớn.
        """
        if (
            frame_a is None
            or frame_b is None
            or frame_a.size == 0
            or frame_b.size == 0
        ):
            raise KeyframeExtractionError(
                "Không thể tính SSIM với frame rỗng."
            )

        def prepare(frame: np.ndarray) -> np.ndarray:
            if frame.ndim == 3 and frame.shape[2] == 3:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            elif frame.ndim == 2:
                gray = frame
            else:
                raise KeyframeExtractionError(
                    "Định dạng frame không hỗ trợ."
                )

            return cv2.resize(
                gray,
                (320, 180),
                interpolation=cv2.INTER_AREA,
            )

        prepared_a = prepare(frame_a)
        prepared_b = prepare(frame_b)

        score = structural_similarity(
            prepared_a,
            prepared_b,
            data_range=255,
        )

        return float(score)

    def select_keyframe_candidates(
        self,
        video_path: str,
        stability_threshold: float = 0.92,
        temporal_diff_threshold: float = 0.005,
        required_stable_transitions: int = 2,
    ):
        """
        Chọn keyframe dựa trên:
        - SSIM giữa các frame liên tiếp.
        - Độ ổn định nội dung theo thời gian.
        - Độ sắc nét của ảnh.
        - Khả năng phát hiện thay đổi nội dung.

        Temporal Stability giúp giảm việc chọn nhầm
        cảnh camera chuyển động thành slide.

        Chưa phân loại được mọi trường hợp slide/camera,
        đặc biệt camera đứng yên và slide xuất hiện rất ngắn.
        """
        if (
            not math.isfinite(stability_threshold)
            or not 0 <= stability_threshold <= 1
        ):
            raise ValueError(
                "stability_threshold phải nằm trong khoảng [0, 1]."
            )

        if (
            not math.isfinite(temporal_diff_threshold)
            or not 0 <= temporal_diff_threshold <= 1
        ):
            raise ValueError(
                "temporal_diff_threshold phải nằm trong khoảng [0, 1]."
            )

        if (
            isinstance(required_stable_transitions, bool)
            or not isinstance(required_stable_transitions, int)
            or required_stable_transitions < 1
        ):
            raise ValueError(
                "required_stable_transitions phải là số nguyên >= 1."
            )

        video_info = self.inspect_video(video_path)

        previous_frame = None
        last_selected_frame = None

        stable_streak = 0

        for timestamp, frame in self.sample_frames(
            video_info["video_path"],
            video_info["duration_seconds"],
        ):
            if previous_frame is None:
                previous_frame = frame
                continue

            stability_score = self.calculate_ssim(
                previous_frame,
                frame,
            )

            # SSIM thấp cho thấy hai frame khác nhau nhiều.
            # Reset chuỗi ổn định khi gặp chuyển cảnh.
            if stability_score < stability_threshold:
                stable_streak = 0
                previous_frame = frame
                continue

            # Đo sự khác biệt sau khi chuẩn hóa và căn chỉnh.
            aligned_diff, _ = self.calculate_aligned_difference(
                previous_frame,
                frame,
            )

            if aligned_diff <= temporal_diff_threshold:
                stable_streak += 1
            else:
                stable_streak = 0

            previous_frame = frame

            # Chỉ xét keyframe khi cảnh đã đủ ổn định.
            if stable_streak < required_stable_transitions:
                continue

            candidate = frame
            candidate_timestamp = timestamp

            candidate_sharpness = self.calculate_sharpness(
                candidate
            )

            # Loại frame không đủ sắc nét.
            if candidate_sharpness < self.min_sharpness:
                continue

            if last_selected_frame is None:
                difference_score = None
                is_new_content = True
            else:
                difference_score = self.calculate_ssim(
                    last_selected_frame,
                    candidate,
                )

                is_new_content = self.is_content_changed(
                    last_selected_frame,
                    candidate,
                )

            if not is_new_content:
                continue

            last_selected_frame = candidate.copy()

            yield {
                "timestamp_seconds": candidate_timestamp,
                "frame": candidate,
                "sharpness_score": candidate_sharpness,
                "ssim_score": difference_score,
            }

            previous_frame = frame
            previous_timestamp = timestamp

    def extract(
        self,
        video_path: str,
        output_dir: str,
    ) -> dict[str, Any]:
        """
        Trích xuất keyframe và công bố kết quả theo phiên bản.

        Mỗi lần chạy ghi JPEG và manifest vào một thư mục
        run_<uuid> riêng biệt.

        current.json chỉ được cập nhật khi kết quả mới
        đã được ghi hoàn tất.

        output_dir phải nằm trong workspace SmartRec.
        """
        import shutil
        import uuid

        video_info = self.inspect_video(video_path)

        workspace_root = get_workspace_root().resolve()
        output_path = Path(output_dir).resolve()

        if (
            output_path == workspace_root
            or workspace_root not in output_path.parents
        ):
            raise PermissionError(
                "Thư mục keyframe phải nằm bên trong workspace SmartRec."
            )

        output_path.mkdir(parents=True, exist_ok=True)

        versions_path = output_path / "versions"
        versions_path.mkdir(parents=True, exist_ok=True)

        # Kiểm tra đường dẫn sau khi tạo thư mục.
        if versions_path.resolve() != versions_path:
            raise PermissionError(
                "Đường dẫn versions không hợp lệ hoặc chứa symlink."
            )

        run_id = f"run_{uuid.uuid4().hex}"
        run_path = versions_path / run_id

        # Không được tái sử dụng thư mục của lần chạy khác.
        run_path.mkdir(parents=False, exist_ok=False)

        pointer_path = output_path / "current.json"
        pointer_temp_path = output_path / f".current_{run_id}.tmp"

        published = False

        try:
            keyframes = []
            unique_frames = []

            for candidate in self.select_keyframe_candidates(
                video_path
            ):
                candidate_frame = candidate["frame"]

                timestamp_ms = round(
                    candidate["timestamp_seconds"] * 1000
                )

                matched_index = None

                # Loại bỏ slide trùng toàn cục.
                for index, existing_frame in enumerate(
                    unique_frames
                ):
                    if not self.is_content_changed(
                        existing_frame,
                        candidate_frame,
                    ):
                        matched_index = index
                        break

                if matched_index is not None:
                    existing_slide = keyframes[matched_index]

                    if timestamp_ms not in existing_slide[
                        "occurrences_ms"
                    ]:
                        existing_slide[
                            "occurrences_ms"
                        ].append(timestamp_ms)

                    continue

                slide_index = len(keyframes) + 1
                slide_id = f"slide_{slide_index:04d}"

                image_filename = f"{slide_id}.jpg"
                image_path = run_path / image_filename

                success = cv2.imwrite(
                    str(image_path),
                    candidate_frame,
                    [cv2.IMWRITE_JPEG_QUALITY, 95],
                )

                if not success:
                    raise KeyframeExtractionError(
                        f"Không thể lưu keyframe: {image_filename}"
                    )

                # Đồng bộ dữ liệu ảnh trước khi công bố.
                with open(image_path, "rb") as image_file:
                    os.fsync(image_file.fileno())

                unique_frames.append(
                    candidate_frame.copy()
                )

                keyframes.append(
                    {
                        "slide_id": slide_id,
                        "timestamp_ms": timestamp_ms,
                        # Requested seek position, not a measured decoder PTS.
                        "timestamp_basis": "sample_target",
                        "occurrences_ms": [timestamp_ms],
                        "image_path": image_filename,
                        "sharpness_score": round(
                            candidate["sharpness_score"], 3
                        ),
                        "ssim_score": (
                            round(candidate["ssim_score"], 4)
                            if candidate["ssim_score"] is not None
                            else None
                        ),
                    }
                )

            manifest = {
                "schema_version": "1.1",
                "source_video": video_info["source_video"],
                "total_keyframes": len(keyframes),
                "keyframes": keyframes,
            }

            # Manifest nằm cùng phiên bản với các JPEG.
            manifest_path = run_path / "manifest.json"

            with open(
                manifest_path,
                "w",
                encoding="utf-8",
            ) as file:
                json.dump(
                    manifest,
                    file,
                    ensure_ascii=False,
                    indent=2,
                )
                file.flush()
                os.fsync(file.fileno())

            # Kiểm tra sự tồn tại của toàn bộ artifacts.
            for item in keyframes:
                saved_image = run_path / item["image_path"]

                if (
                    not saved_image.is_file()
                    or saved_image.stat().st_size == 0
                ):
                    raise KeyframeExtractionError(
                        "Keyframe không tồn tại hoặc rỗng: "
                        f"{item['image_path']}"
                    )

            # Con trỏ luôn sử dụng đường dẫn tương đối
            # tính từ output_dir.
            current_pointer = {
                "schema_version": "1.0",
                "run_id": run_id,
                "manifest_path": (
                    f"versions/{run_id}/manifest.json"
                ),
            }

            with open(
                pointer_temp_path,
                "w",
                encoding="utf-8",
            ) as file:
                json.dump(
                    current_pointer,
                    file,
                    ensure_ascii=False,
                    indent=2,
                )
                file.flush()
                os.fsync(file.fileno())

            # Chỉ công bố sau khi toàn bộ artifacts hoàn tất.
            os.replace(
                pointer_temp_path,
                pointer_path,
            )

            published = True

            return manifest

        finally:
            # Xóa file con trỏ tạm nếu còn tồn tại.
            if pointer_temp_path.exists():
                pointer_temp_path.unlink()

            # Nếu chưa công bố thành công, chỉ xóa
            # thư mục phiên bản do lần chạy này tạo.
            if not published and run_path.exists():
                shutil.rmtree(run_path)

    @staticmethod
    def normalize_content(frame: np.ndarray) -> np.ndarray:
        """
        Chuẩn hóa frame để so sánh nội dung slide.

        Giảm nhiễu và ảnh hưởng của thay đổi độ sáng.
        Không sử dụng ảnh đã chuẩn hóa làm đầu vào PaddleOCR.
        """
        if frame is None or frame.size == 0:
            raise KeyframeExtractionError("Frame rỗng hoặc không hợp lệ.")

        if frame.ndim == 3 and frame.shape[2] == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        elif frame.ndim == 2:
            gray = frame
        else:
            raise KeyframeExtractionError("Định dạng frame không hỗ trợ.")

        if gray.dtype != np.uint8:
            raise KeyframeExtractionError(
                "Frame phải có kiểu dữ liệu uint8."
            )

        blurred = cv2.GaussianBlur(
            gray,
            (5, 5),
            1.0,
        )

        return cv2.adaptiveThreshold(
            blurred,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            10,
        )

    @classmethod
    def calculate_aligned_difference(
        cls,
        frame_a: np.ndarray,
        frame_b: np.ndarray,
        max_shift: int = 2,
    ) -> tuple[float, tuple[int, int]]:
        """
        So sánh nội dung hai frame sau chuẩn hóa và căn chỉnh.

        Trả về:
        - difference_ratio: tỷ lệ pixel khác nhau trong [0, 1].
        - best_shift: độ dịch chuyển (dx, dy).

        Chỉ xử lý dịch chuyển tịnh tiến nhỏ.
        """
        if (
            isinstance(max_shift, bool)
            or not isinstance(max_shift, int)
            or max_shift < 0
        ):
            raise ValueError("max_shift phải là số nguyên không âm.")

        normalized_a = cls.normalize_content(frame_a)
        normalized_b = cls.normalize_content(frame_b)

        if normalized_a.shape != normalized_b.shape:
            raise KeyframeExtractionError(
                "Hai frame phải có cùng kích thước."
            )

        height, width = normalized_a.shape
        margin = max_shift

        if height <= 2 * margin or width <= 2 * margin:
            raise KeyframeExtractionError(
                "Frame quá nhỏ so với phạm vi căn chỉnh."
            )

        reference = normalized_a[
            margin:height - margin if margin else height,
            margin:width - margin if margin else width,
        ]

        best_score = 1.0
        best_shift = (0, 0)

        for dy in range(-max_shift, max_shift + 1):
            for dx in range(-max_shift, max_shift + 1):
                candidate = normalized_b[
                    margin + dy:height - margin + dy if margin else height,
                    margin + dx:width - margin + dx if margin else width,
                ]

                score = float(
                    np.count_nonzero(
                        cv2.absdiff(reference, candidate)
                    ) / reference.size
                )

                if score < best_score:
                    best_score = score
                    best_shift = (dx, dy)

        return best_score, best_shift

    def is_content_changed(
        self,
        frame_a: np.ndarray,
        frame_b: np.ndarray,
        content_threshold: float = 0.0005,
    ) -> bool:
        """
        Nhận diện thay đổi nội dung bằng Global SSIM
        kết hợp Aligned Content Difference.

        Ngưỡng content_threshold chỉ là giá trị thử nghiệm,
        chưa được tối ưu trên video thực tế.
        """
        if (
            not math.isfinite(content_threshold)
            or not 0 <= content_threshold <= 1
        ):
            raise ValueError(
                "content_threshold phải nằm trong khoảng [0, 1]."
            )

        global_ssim = self.calculate_ssim(frame_a, frame_b)

        # Thay đổi lớn về cấu trúc hoặc bố cục.
        if global_ssim < self.ssim_threshold:
            return True

        # Thay đổi nhỏ về chữ hoặc thành phần nội dung.
        difference_ratio, _ = self.calculate_aligned_difference(
            frame_a,
            frame_b,
        )

        return difference_ratio > content_threshold
