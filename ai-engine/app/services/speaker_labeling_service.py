import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Union, Optional, Dict, Any, List, Tuple

from app.schemas.diarization_schemas import (
    SpeakerSegmentationResponse,
    SpeakerSegment,
    SpeakerProfile,
    SpeakerHierarchicalSegment,
    DiarizationExportPayload
)
from app.services.speaker_diarizer import speaker_diarization_service
from app.services.diarization_runtime import diarization_runtime

logger = logging.getLogger("smartrec.speaker_labeling")


class SpeakerLabelingService:
    """
    Dịch vụ ánh xạ nhãn người nói (Speaker 1, Speaker 2...), trích xuất embedding
    và xuất kết quả JSON chuẩn hóa an toàn tuyệt đối cho downstream AI modules.
    """

    def generate_speaker_labels(
        self,
        raw_segments: List[SpeakerSegment]
    ) -> Dict[str, str]:
        """
        Ánh xạ raw_speaker_id sang label thân thiện (Speaker 1, Speaker 2...)
        theo đúng thứ tự xuất hiện đầu tiên trên timeline thực tế.
        """
        mapping: Dict[str, str] = {}
        speaker_idx = 1

        sorted_segments = sorted(raw_segments, key=lambda s: (s.start_seconds, s.end_seconds))

        for seg in sorted_segments:
            raw_spk = seg.speaker
            if raw_spk not in mapping:
                mapping[raw_spk] = f"Speaker {speaker_idx}"
                speaker_idx += 1

        return mapping

    def build_export_payload(
        self,
        segmentation_res: SpeakerSegmentationResponse,
        audio_file_path: Union[str, Path],
        speaker_embeddings: Optional[Dict[str, List[float]]] = None,
        embeddings_error: Optional[str] = None
    ) -> DiarizationExportPayload:
        """
        Tổ chức cấu trúc dữ liệu JSON đáp ứng:
        1. Phân cấp: Speaker -> Segment (start, end)
        2. Tuyến tính: Timeline sorted segments
        3. Minh bạch trạng thái Speaker Embeddings (COMPLETED | PARTIAL | FAILED | NOT_AVAILABLE)
        """
        audio_name = Path(audio_file_path).name
        embeddings_map = speaker_embeddings or {}

        if segmentation_res.status != "SUCCESS" or not segmentation_res.segments:
            return DiarizationExportPayload(
                job_id=segmentation_res.job_id,
                audio_file=audio_name,
                status=segmentation_res.status,
                audio_duration_seconds=segmentation_res.audio_duration_seconds,
                speech_duration_seconds=segmentation_res.speech_duration_seconds,
                speech_ratio=segmentation_res.speech_ratio,
                total_speakers=0,
                speaker_mapping={},
                speakers=[],
                timeline=[],
                embeddings_status="NOT_AVAILABLE",
                error_code=segmentation_res.error_code,
                error_message=segmentation_res.error_message
            )

        sorted_raw_segments = sorted(
            segmentation_res.segments,
            key=lambda s: (s.start_seconds, s.end_seconds)
        )

        label_mapping = self.generate_speaker_labels(sorted_raw_segments)

        timeline_segments: List[SpeakerSegment] = []
        for seg in sorted_raw_segments:
            friendly_label = label_mapping[seg.speaker]
            spk_emb = embeddings_map.get(seg.speaker)

            timeline_segments.append(SpeakerSegment(
                segment_id=seg.segment_id,
                speaker=friendly_label,
                raw_speaker_id=seg.speaker,
                start_seconds=seg.start_seconds,
                end_seconds=seg.end_seconds,
                duration_seconds=seg.duration_seconds,
                start_time=seg.start_time,
                end_time=seg.end_time,
                embedding=spk_emb
            ))

        for idx, seg in enumerate(timeline_segments, start=1):
            seg.segment_id = idx

        speakers_dict: Dict[str, Dict[str, Any]] = {}
        for raw_spk, friendly_label in label_mapping.items():
            speakers_dict[friendly_label] = {
                "raw_speaker_id": raw_spk,
                "segments": [],
                "total_duration": 0.0,
                "embedding": embeddings_map.get(raw_spk)
            }

        for seg in timeline_segments:
            spk_entry = speakers_dict[seg.speaker]
            spk_entry["segments"].append(SpeakerHierarchicalSegment(
                segment_id=seg.segment_id,
                start=seg.start_seconds,
                end=seg.end_seconds,
                duration=seg.duration_seconds,
                start_time=seg.start_time,
                end_time=seg.end_time
            ))
            spk_entry["total_duration"] = round(spk_entry["total_duration"] + seg.duration_seconds, 3)

        speakers_list: List[SpeakerProfile] = []
        for friendly_label, data in speakers_dict.items():
            speakers_list.append(SpeakerProfile(
                speaker_label=friendly_label,
                raw_speaker_id=data["raw_speaker_id"],
                total_segments=len(data["segments"]),
                total_speech_duration_seconds=round(data["total_duration"], 3),
                embedding=data["embedding"],
                segments=data["segments"]
            ))

        # Xác định trạng thái Embeddings minh bạch
        total_spk_count = len(speakers_list)
        embedded_spk_count = sum(1 for s in speakers_list if s.embedding is not None)

        if embeddings_error:
            emb_status = "FAILED"
        elif total_spk_count == 0:
            emb_status = "NOT_AVAILABLE"
        elif embedded_spk_count == total_spk_count:
            emb_status = "COMPLETED"
        elif embedded_spk_count > 0:
            emb_status = "PARTIAL"
        else:
            emb_status = "NOT_AVAILABLE"

        return DiarizationExportPayload(
            job_id=segmentation_res.job_id,
            audio_file=audio_name,
            status="SUCCESS",
            audio_duration_seconds=segmentation_res.audio_duration_seconds,
            speech_duration_seconds=segmentation_res.speech_duration_seconds,
            speech_ratio=segmentation_res.speech_ratio,
            total_speakers=len(speakers_list),
            speaker_mapping=label_mapping,
            speakers=speakers_list,
            timeline=timeline_segments,
            embeddings_status=emb_status
        )

    def export_to_json_file(
        self,
        payload: DiarizationExportPayload,
        output_path: Union[str, Path]
    ) -> Path:
        """
        Xác thực dữ liệu Pydantic và ghi ra file JSON nguyên tử (Atomic file write).
        Sử dụng tempfile.NamedTemporaryFile trong cùng thư mục đích kèm os.fsync()
        để đảm bảo không bao giờ tạo file rác hoặc ghi hỏng khi nhiều tiến trình ghi đồng thời.
        """
        target_path = Path(output_path).resolve()

        try:
            target_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception as dir_err:
            logger.error(f"Không thể tạo thư mục đích '{target_path.parent}': {dir_err}")
            raise IOError(f"Không thể tạo thư mục lưu file JSON: {dir_err}") from dir_err

        try:
            json_str = payload.model_dump_json(indent=2)
        except Exception as val_err:
            logger.error(f"Lỗi validate schema trước khi ghi file JSON: {val_err}")
            raise ValueError(f"Dữ liệu JSON không hợp lệ theo Schema: {val_err}") from val_err

        temp_file_path: Optional[Path] = None
        try:
            # Tạo file tạm duy nhất ngay trong cùng thư mục đích để bảo đảm cùng filesystem
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=str(target_path.parent),
                prefix=f"{target_path.stem}_",
                suffix=".tmp",
                delete=False
            ) as tf:
                temp_file_path = Path(tf.name)
                tf.write(json_str)
                tf.flush()
                os.fsync(tf.fileno())

            # Atomic replace (Last-writer-wins an toàn)
            os.replace(temp_file_path, target_path)
            logger.info(f"Xuất file kết quả JSON thành công: {target_path}")
            return target_path

        except Exception as io_err:
            if temp_file_path and temp_file_path.exists():
                try:
                    temp_file_path.unlink(missing_ok=True)
                except Exception:
                    pass
            logger.error(f"Lỗi ghi file JSON ra đĩa tại '{target_path}': {io_err}")
            raise IOError(f"Không thể lưu file JSON kết quả: {io_err}") from io_err

    def process_and_export(
        self,
        audio_path: Union[str, Path],
        output_json_path: Optional[Union[str, Path]] = None,
        job_id: Optional[str] = None,
        speaker_embeddings: Optional[Dict[str, List[float]]] = None
    ) -> Tuple[DiarizationExportPayload, Optional[Path]]:
        """
        Quy trình trọn gói: VAD/Segmentation -> Sinh Embeddings -> Labeling -> JSON File Export.
        """
        seg_res = speaker_diarization_service.segment_speech(audio_path, job_id=job_id)

        effective_embeddings = speaker_embeddings
        embeddings_error_msg = None

        if effective_embeddings is None and seg_res.status == "SUCCESS" and seg_res.segments:
            try:
                effective_embeddings = diarization_runtime.extract_speaker_embeddings(
                    audio_path=audio_path,
                    speaker_segments=seg_res.segments
                )
            except Exception as emb_err:
                logger.error(f"Không thể tự động sinh speaker embeddings: {emb_err}")
                embeddings_error_msg = str(emb_err)
                effective_embeddings = {}

        payload = self.build_export_payload(
            seg_res,
            audio_file_path=audio_path,
            speaker_embeddings=effective_embeddings,
            embeddings_error=embeddings_error_msg
        )

        saved_path = None
        if output_json_path:
            saved_path = self.export_to_json_file(payload, output_json_path)

        return payload, saved_path


speaker_labeling_service = SpeakerLabelingService()
