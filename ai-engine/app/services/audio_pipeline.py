import os
import time
import wave
import struct
import math
import uuid
import shutil
import logging
from typing import Dict, Any, Optional


from app.schemas.audio_schemas import (
    AudioPipelineRequest,
    AudioPipelineResponse,
    QualityCheckMetrics,
    StepLogEntry
)
from app.services.audio_aec import AudioAECService
from app.services.audio_ans import AudioANSService

logger = logging.getLogger(__name__)


class AudioPipelineError(Exception):
    pass


class AudioPipelineOrchestrator:

    def __init__(
        self,
        aec_service: Optional[AudioAECService] = None,
        ans_service: Optional[AudioANSService] = None
    ):
        self.aec_service = aec_service or AudioAECService()
        self.ans_service = ans_service or AudioANSService(default_suppression_level=3)

    def _inspect_wav_header(self, file_path: str) -> Dict[str, Any]:
        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"File âm thanh không tồn tại: {file_path}")

        with wave.open(file_path, "rb") as wf:
            channels = wf.getnchannels()
            sample_rate = wf.getframerate()
            sampwidth = wf.getsampwidth()
            n_frames = wf.getnframes()
            duration = n_frames / float(sample_rate) if sample_rate > 0 else 0.0
            file_size = os.path.getsize(file_path)

        return {
            "channels": channels,
            "sample_rate": sample_rate,
            "sampwidth": sampwidth,
            "n_frames": n_frames,
            "duration_seconds": round(duration, 3),
            "file_size_bytes": file_size
        }

    def _validate_input_standards(self, file_path: str, label: str = "Input Audio") -> Dict[str, Any]:
        meta = self._inspect_wav_header(file_path)
        if meta["sample_rate"] != 16000:
            raise ValueError(f"{label} có sample rate {meta['sample_rate']}Hz không đúng chuẩn (16000Hz).")
        if meta["channels"] != 1:
            raise ValueError(f"{label} có số kênh {meta['channels']} không đúng chuẩn Mono (1 kênh).")
        if meta["sampwidth"] != 2:
            raise ValueError(f"{label} có độ sâu mẫu {meta['sampwidth']*8}-bit không đúng chuẩn PCM 16-bit.")
        return meta

    def _perform_quality_check(
        self,
        output_file: str,
        expected_frames: int
    ) -> QualityCheckMetrics:
        """
        Kiểm định chất lượng audio đầu ra (Acceptance Criteria QC).
        Ưu tiên kiểm tra cấu trúc Header trước để tránh crash khi unpack mẫu sai định dạng.
        """
        meta = self._inspect_wav_header(output_file)
        drift_samples = abs(meta["n_frames"] - expected_frames)

        # 1. FIX: Kiểm tra điều kiện tiên quyết về định dạng Header TRƯỚC KHI giải mã mẫu
        header_errors = []
        if meta["sampwidth"] != 2:
            header_errors.append(f"Độ sâu bit không đạt chuẩn PCM 16-bit ({meta['sampwidth']*8}-bit).")
        if meta["sample_rate"] != 16000:
            header_errors.append(f"Sample rate {meta['sample_rate']}Hz không đạt chuẩn 16000Hz.")
        if meta["channels"] != 1:
            header_errors.append(f"Số kênh {meta['channels']} không đạt chuẩn Mono.")
        if drift_samples > 0:
            header_errors.append(f"Vi phạm Zero Duration Drift (Lệch {drift_samples} mẫu âm thanh).")

        # Nếu sai chuẩn header, trả ngay kết quả FAILED có cấu trúc, không gọi struct.unpack để tránh struct.error
        if header_errors:
            return QualityCheckMetrics(
                passed=False,
                sample_rate=meta["sample_rate"],
                channels=meta["channels"],
                duration_seconds=meta["duration_seconds"],
                file_size_bytes=meta["file_size_bytes"],
                rms_energy=0.0,
                is_silent=False,
                is_clipped=False,
                duration_drift_samples=drift_samples,
                error_message="; ".join(header_errors)
            )

        # 2. Giải mã mẫu an toàn khi đã đảm bảo chuẩn PCM 16-bit
        max_amplitude = 0
        sum_squares = 0.0
        sample_count = 0
        clipped_samples = 0

        with wave.open(output_file, "rb") as wf:
            chunk_size = 4096
            while True:
                frames = wf.readframes(chunk_size)
                if not frames:
                    break
                count = len(frames) // 2
                unpacked = struct.unpack(f"<{count}h", frames)
                for s in unpacked:
                    abs_s = abs(s)
                    if abs_s > max_amplitude:
                        max_amplitude = abs_s
                    if abs_s >= 32767:
                        clipped_samples += 1
                    sum_squares += float(s) * float(s)
                sample_count += count

        rms = math.sqrt(sum_squares / sample_count) if sample_count > 0 else 0.0
        is_silent = rms < 10.0

        clipping_ratio = (clipped_samples / sample_count) if sample_count > 0 else 0.0
        is_clipped = clipping_ratio > 0.005

        passed = (not is_silent) and (not is_clipped)

        error_msg = None
        if not passed:
            reasons = []
            if is_silent:
                reasons.append("Âm thanh bị mất tín hiệu (hoàn toàn yên lặng).")
            if is_clipped:
                reasons.append(f"Xuất hiện hiện tượng xén/vỡ biên độ âm thanh (Max Amp: {max_amplitude}).")
            error_msg = "; ".join(reasons)

        return QualityCheckMetrics(
            passed=passed,
            sample_rate=meta["sample_rate"],
            channels=meta["channels"],
            duration_seconds=meta["duration_seconds"],
            file_size_bytes=meta["file_size_bytes"],
            rms_energy=round(rms, 2),
            is_silent=is_silent,
            is_clipped=is_clipped,
            duration_drift_samples=drift_samples,
            error_message=error_msg
        )

    def process_pipeline(self, request: AudioPipelineRequest) -> AudioPipelineResponse:
        start_pipeline_time = time.time()
        step_logs = []

        input_abs = os.path.realpath(request.input_path)
        base_out_dir = os.path.realpath(request.output_dir) if request.output_dir else os.path.dirname(input_abs)

        exec_nonce = uuid.uuid4().hex
        job_workspace = os.path.join(base_out_dir, f"job_{request.job_id}_{exec_nonce}")
        base_stem = os.path.splitext(os.path.basename(input_abs))[0]
        step1_output = os.path.join(job_workspace, f"{request.job_id}_{base_stem}_step1_aec.wav")
        final_output = os.path.join(job_workspace, f"{request.job_id}_{base_stem}_cleaned_final.wav")

        current_file = input_abs
        expected_frames = 0
        input_duration = 0.0
        pipeline_succeeded = False

        try:
            os.makedirs(job_workspace, exist_ok=True)
            # BƯỚC 1: VALIDATION
            t0 = time.time()
            try:
                in_meta = self._validate_input_standards(current_file, "Input Audio")
                expected_frames = in_meta["n_frames"]
                input_duration = in_meta["duration_seconds"]

                ref_valid = False
                ref_bypass_reason = None
                if request.reference_path:
                    ref_abs = os.path.realpath(request.reference_path)
                    if os.path.isfile(ref_abs):
                        try:
                            self._validate_input_standards(ref_abs, "Reference Audio")
                            ref_valid = True
                        except Exception as ref_err:
                            ref_valid = False
                            ref_bypass_reason = f"Reference audio không hợp lệ: {str(ref_err)}"
                            logger.warning(f"PIPE-AEC: {ref_bypass_reason}. Kích hoạt fallback an toàn sang ANS.")
                    else:
                        ref_valid = False
                        ref_bypass_reason = f"Reference file không tồn tại trên đĩa: {request.reference_path}"
                        logger.warning(f"PIPE-AEC: {ref_bypass_reason}. Kích hoạt fallback an toàn sang ANS.")

                step_logs.append(StepLogEntry(
                    step="VALIDATION",
                    status="SUCCESS",
                    input_file=request.input_path,
                    output_file=request.input_path,
                    input_duration=input_duration,
                    output_duration=input_duration,
                    processing_time_seconds=round(time.time() - t0, 3),
                    metrics={"sample_rate": in_meta["sample_rate"], "channels": in_meta["channels"]}
                ))
            except Exception as err:
                step_logs.append(StepLogEntry(
                    step="VALIDATION",
                    status="FAILED",
                    input_file=request.input_path,
                    output_file=request.input_path,
                    input_duration=0.0,
                    output_duration=0.0,
                    processing_time_seconds=round(time.time() - t0, 3),
                    error_message=str(err)
                ))
                return AudioPipelineResponse(
                    job_id=request.job_id,
                    session_id=request.session_id,
                    overall_status="FAILED",
                    total_processing_time_seconds=round(time.time() - start_pipeline_time, 3),
                    step_logs=step_logs,
                    error_message=f"Xác thực đầu vào thất bại: {str(err)}"
                )

            # BƯỚC 2: AEC
            t0 = time.time()
            if ref_valid:
                aec_res = self.aec_service.cancel_echo(
                    capture_path=current_file,
                    reference_path=os.path.realpath(request.reference_path),
                    output_path=step1_output
                )
                step_logs.append(StepLogEntry(
                    step="AEC",
                    status=aec_res["status"],
                    input_file=current_file,
                    output_file=step1_output,
                    input_duration=input_duration,
                    output_duration=input_duration,
                    processing_time_seconds=round(time.time() - t0, 3),
                    metrics={"erle_db": aec_res.get("erle_db", 0.0), "reference_provided": True}
                ))
                current_file = step1_output
            else:
                status_label = "BYPASS_INVALID_REFERENCE" if ref_bypass_reason else "BYPASS_NO_REFERENCE"
                metrics_dict = {"reference_provided": bool(request.reference_path)}
                if ref_bypass_reason:
                    metrics_dict["reason"] = ref_bypass_reason

                step_logs.append(StepLogEntry(
                    step="AEC",
                    status=status_label,
                    input_file=current_file,
                    output_file=current_file,
                    input_duration=input_duration,
                    output_duration=input_duration,
                    processing_time_seconds=round(time.time() - t0, 3),
                    metrics=metrics_dict,
                    error_message=ref_bypass_reason
                ))

            # BƯỚC 3: ANS
            t0 = time.time()
            ans_res = self.ans_service.apply_noise_suppression(
                input_path=current_file,
                output_path=final_output,
                suppression_level=request.suppression_level
            )
            step_logs.append(StepLogEntry(
                step="ANS",
                status=ans_res["status"],
                input_file=current_file,
                output_file=final_output,
                input_duration=input_duration,
                output_duration=input_duration,
                processing_time_seconds=round(time.time() - t0, 3),
                metrics={"noise_reduction_db": ans_res.get("noise_reduction_db", 0.0)}
            ))
            current_file = final_output

            # BƯỚC 4: QUALITY CHECK
            t0 = time.time()
            qc_metrics = self._perform_quality_check(current_file, expected_frames)
            qc_status = "SUCCESS" if qc_metrics.passed else "FAILED"

            step_logs.append(StepLogEntry(
                step="QUALITY_CHECK",
                status=qc_status,
                input_file=current_file,
                output_file=current_file,
                input_duration=input_duration,
                output_duration=qc_metrics.duration_seconds,
                processing_time_seconds=round(time.time() - t0, 3),
                metrics=qc_metrics.model_dump(),
                error_message=qc_metrics.error_message
            ))

            pipeline_succeeded = qc_metrics.passed
            overall_status = "SUCCESS" if pipeline_succeeded else "FAILED"

            return AudioPipelineResponse(
                job_id=request.job_id,
                session_id=request.session_id,
                overall_status=overall_status,
                final_output_file=final_output if pipeline_succeeded else None,
                total_processing_time_seconds=round(time.time() - start_pipeline_time, 3),
                quality_check=qc_metrics,
                step_logs=step_logs,
                error_message=qc_metrics.error_message
            )

        except Exception as err:
            return AudioPipelineResponse(
                job_id=request.job_id,
                session_id=request.session_id,
                overall_status="FAILED",
                total_processing_time_seconds=round(time.time() - start_pipeline_time, 3),
                step_logs=step_logs,
                error_message=f"Lỗi thực thi Pipeline: {str(err)}"
            )

        finally:
            # Dọn dẹp an toàn có log cảnh báo rõ ràng nếu xảy ra lỗi filesystem
            if os.path.isfile(step1_output):
                try:
                    os.remove(step1_output)
                except OSError as e:
                    logger.warning(f"Không thể dọn dẹp file tạm AEC ({step1_output}): {e}")

            # 2. FIX: Bỏ ignore_errors=True để bắt đúng OSError và kích hoạt logger.warning
            if not pipeline_succeeded and os.path.exists(job_workspace):
                try:
                    shutil.rmtree(job_workspace)
                except OSError as e:
                    logger.warning(f"Không thể dọn dẹp workspace lỗi ({job_workspace}): {e}")
