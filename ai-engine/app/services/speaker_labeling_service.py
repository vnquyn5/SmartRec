import json
import logging
import os
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

logger = logging.getLogger("smartrec.speaker_labeling")


class SpeakerLabelingService:
    """
    Dịch vụ ánh xạ nhãn người nói (Speaker 1, Speaker 2...), trích xuất embedding
    và xuất kết quả JSON chuẩn hóa cho các downstream AI modules.
    """

    def generate_speaker_labels(
        self,
        raw_segments: List[SpeakerSegment]
    ) -> Dict[str, str]:
        """
        Ánh xạ raw_speaker_id (SPEAKER_00, SPEAKER_01...) sang label thân thiện
        (Speaker 1, Speaker 2...) theo đúng thứ tự xuất hiện đầu tiên trên timeline thực tế.
        Tự động sắp xếp lại theo timestamp trước khi map để chống sai lệch thứ tự đầu vào.
        """
        mapping: Dict[str, str] = {}
        speaker_idx = 1

        # Sắp xếp theo mốc thời gian bắt đầu trước khi xác định thứ tự xuất hiện đầu tiên
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
        speaker_embeddings: Optional[Dict[str, List[float]]] = None
    ) -> DiarizationExportPayload:
        """
        Tổ chức cấu trúc dữ liệu JSON đáp ứng:
        1. Phân cấp: Speaker -> Segment (start, end)
        2. Tuyến tính: Timeline sorted segments
        3. Speaker embedding/features nếu pipeline cung cấp
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
                error_message=segmentation_res.error_message
            )

        # 1. Sắp xếp danh sách segments theo thứ tự thời gian toàn cục ngay từ đầu
        sorted_raw_segments = sorted(
            segmentation_res.segments,
            key=lambda s: (s.start_seconds, s.end_seconds)
        )

        # 2. Tạo mapping nhất quán dựa trên thứ tự timeline thực tế
        label_mapping = self.generate_speaker_labels(sorted_raw_segments)

        # 3. Chuẩn hóa danh sách Timeline phẳng
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

        # Đánh lại segment_id tăng dần 1, 2, 3... theo timeline sau khi đã sắp xếp
        for idx, seg in enumerate(timeline_segments, start=1):
            seg.segment_id = idx

        # 4. Tạo cấu trúc phân cấp: Speaker -> Segments
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
            timeline=timeline_segments
        )

    def export_to_json_file(
        self,
        payload: DiarizationExportPayload,
        output_path: Union[str, Path]
    ) -> Path:
        """
        Xác thực dữ liệu Pydantic và ghi ra file JSON nguyên tử (Atomic file write).
        Phát hiện và thông báo lỗi rõ ràng nếu không thể ghi file.
        """
        target_path = Path(output_path).resolve()
        target_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            json_str = payload.model_dump_json(indent=2)
        except Exception as val_err:
            logger.error(f"Lỗi validate schema trước khi ghi file JSON: {val_err}")
            raise ValueError(f"Dữ liệu JSON không hợp lệ theo Schema: {val_err}") from val_err

        temp_file = target_path.with_suffix(".tmp")
        try:
            with open(temp_file, "w", encoding="utf-8") as f:
                f.write(json_str)
            temp_file.replace(target_path)
            logger.info(f"Xuất file kết quả JSON thành công: {target_path}")
            return target_path
        except Exception as io_err:
            if temp_file.exists():
                temp_file.unlink(missing_ok=True)
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
        Quy trình trọn gói: VAD/Segmentation -> Labeling & Structuring -> JSON File Export.
        """
        seg_res = speaker_diarization_service.segment_speech(audio_path, job_id=job_id)
        payload = self.build_export_payload(
            seg_res,
            audio_file_path=audio_path,
            speaker_embeddings=speaker_embeddings
        )

        saved_path = None
        if output_json_path:
            saved_path = self.export_to_json_file(payload, output_json_path)

        return payload, saved_path


speaker_labeling_service = SpeakerLabelingService()
