package com.example.smartrec.service.impl;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

import com.example.smartrec.config.SttProperties;
import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Transcript;
import com.example.smartrec.enums.JobStatus;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.SttRequest;
import com.example.smartrec.model.dto.SttResponse;
import com.example.smartrec.model.dto.SttResultRequest;
import com.example.smartrec.model.dto.SttResultRequest.TranscriptSegment;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.TranscriptRepository;
import com.example.smartrec.service.SttService;

import jakarta.transaction.Transactional;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.Setter;
import lombok.experimental.var;

@Service
@RequiredArgsConstructor
public class SttServiceImpl implements SttService {
    private final TranscriptRepository transcriptRepository;
    private final SttProperties properties;
    private final RestTemplate restTemplate;
    private final JobRepository jobRepository;

    @Override
    public SttResponse requestStt(SttRequest request) {

        if (request.getMeetingId() == null
                || request.getProcessingJobId() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_INVALID_STT_REQUEST",
                    "meetingId và processingJobId không được để trống");
        }

        validateJobMeeting(
                request.getMeetingId(),
                request.getProcessingJobId());
        // nhan du lieu tu Stt tra ve SttReponse
        String model = hasText(request.getModelName()) ? request.getModelName() : properties.getStt().getDefaultModel();
        // neu request co ngon ngu thi su dung ngon ngu do
        String language = hasText(request.getLanguage()) ? request.getLanguage()
                : properties.getStt().getDefaultLanguage();
        EngineRequest engineRequest = new EngineRequest(request.getMeetingId(), request.getProcessingJobId(), model,
                language);
        try {
            HttpHeaders headers = new HttpHeaders();
            // bao cho AI biet body reuest la json
            headers.setContentType(MediaType.APPLICATION_JSON);
            // them token noi bo lay tu cau hinh
            // AI phai xac minh token nay neu dung no de xac thuc
            headers.set("X-Internal-Token", properties.getAiEngine().getInternalToken());

            // ket hop body EngineRequest va headers thanh HTTP entity
            HttpEntity<EngineRequest> entity = new HttpEntity<>(engineRequest, headers);

            // Gửi HTTP POST đến URL AI Engine.
            // Tham số 1: URL đích.
            // Tham số 2: phương thức POST.
            // Tham số 3: body và headers.
            // Tham số 4: không cần ánh xạ response body vào Java object.
            // Nếu HTTP response là lỗi, RestTemplate thường ném exception.
            restTemplate.exchange(properties.getAiEngine().getBaseUrl() + properties.getStt().getRequestPath(),
                    HttpMethod.POST, entity, Void.class);
            return new SttResponse(
                    request.getMeetingId(),
                    request.getProcessingJobId(),
                    "QUEUED",
                    "Yêu cầu STT đã được chấp nhận");
        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.BAD_GATEWAY,
                    "ERR_STT_ENGINE_UNAVAILABLE",
                    "Không thể gửi yêu cầu STT đến AI ");
        }
    }

    @Override
    @Transactional
    public SttResponse receiveResult(SttResultRequest request) {
        UUID meetingId = request.getMeetingId();
        UUID jobId = request.getProcessingJobId();
        if (meetingId == null || jobId == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_INVALID_STT_RESULT",
                    "meetingId và processingJobId không được để trống");
        }

        Job job = validateJobMeeting(meetingId, jobId);

        // kiem tra success co bi bo trong khong
        if (request.getSuccess() == null) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_INVALID_STT_RESULT",
                    " success không được để trống");
        }
        // neu AI bao xu ly that bai thi tra loi nghiep vu
        if (Boolean.FALSE.equals(request.getSuccess())) {
            String errorMessage = hasText(request.getErrorMessage())
                    ? request.getErrorMessage()
                    : "Quy trình xử lý STT thất bại";

            job.setStatus(JobStatus.FAILED);
            job.setErrorCode("ERR_STT_PROCESSING_FAILED");
            job.setErrorMessage(errorMessage);
            job.setFailedAt(Instant.now());

            jobRepository.save(job);

            throw new BusinessException(
                    HttpStatus.UNPROCESSABLE_ENTITY,
                    "ERR_STT_PROCESSING_FAILED",
                    errorMessage);
        }
        List<TranscriptSegment> segments = request.getSegments();

        if (segments == null || segments.isEmpty()) {
            throw new BusinessException(
                    HttpStatus.BAD_REQUEST,
                    "ERR_EMPTY_TRANSCRIPT",
                    "Kết quả STT phải có ít nhất một đoạn transcript");
        }
        // 4. Kiem tra thoi gian tung doan
        for (TranscriptSegment segment : segments) {
            if (segment.getSpeakerId() == null) {
                throw new BusinessException(
                        HttpStatus.BAD_REQUEST,
                        "ERR_INVALID_SPEAKER",
                        "speakerId không được để trống");
            }
            if (segment.getStartTimeMs() == null
                    || segment.getEndTimeMs() == null
                    || segment.getStartTimeMs() < 0
                    || segment.getEndTimeMs() < segment.getStartTimeMs()) {

                throw new BusinessException(
                        HttpStatus.BAD_REQUEST,
                        "ERR_INVALID_TRANSCRIPT_TIME",
                        "Thời gian transcript không hợp lệ");
            }
            if (segment.getText() == null || segment.getText().isBlank()) {
                throw new BusinessException(
                        HttpStatus.BAD_REQUEST,
                        "ERR_EMPTY_TRANSCRIPT",
                        "Nội dung transcript không được để trống");
            }
        }

        // tim tat ca cac transcript da luu cho job nay
        // kq duoc sap xep theo startTimeMs tang dan
        List<Transcript> existing = transcriptRepository.findByProcessingJobIdOrderByStartTimeMsAsc(jobId);
        // neu da co transcript cua job nay thi kiem tra truoc khi xu ly lai
        if (!existing.isEmpty()) {

            boolean sameMeeting = existing.stream()
                    .allMatch(t -> meetingId.equals(t.getMeetingId()));

            // neu job dang gan voi cuoc hop khac thi tu choi callback
            if (!sameMeeting) {
                throw new BusinessException(
                        HttpStatus.CONFLICT,
                        "ERR_STT_JOB_MEETING_MISMATCH",
                        "Job không thuộc cuộc họp được yêu cầu");
            }
            // Callback duoc gui lai: khong luu trung
            return new SttResponse(
                    meetingId,
                    jobId,
                    "COMPLETED",
                    "Transcript đã được lưu");
        }
        List<Transcript> transcripts = new ArrayList<>();
        for (TranscriptSegment segment : segments) {
            Transcript transcript = new Transcript();

            transcript.setMeetingId(meetingId);
            transcript.setProcessingJobId(jobId);
            transcript.setSpeakerId(segment.getSpeakerId());
            transcript.setStartTimeMs(segment.getStartTimeMs());
            transcript.setEndTimeMs(segment.getEndTimeMs());
            transcript.setTextContent(segment.getText());

            transcripts.add(transcript);
        }
        transcriptRepository.saveAll(transcripts);

        return new SttResponse(
                meetingId,
                jobId,
                "COMPLETED",
                "Đã lưu transcript thành công");

    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private record EngineRequest(
            UUID meetingId,
            UUID processingJobId,
            String modelName,
            String language) {
    }

    private Job validateJobMeeting(UUID meetingId, UUID jobId) {
        Job job = jobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "ERR_JOB_NOT_FOUND",
                        "Không tìm thấy processing job"));

        if (!meetingId.equals(job.getMeetingId())) {
            throw new BusinessException(
                    HttpStatus.CONFLICT,
                    "ERR_STT_JOB_MEETING_MISMATCH",
                    "Job không thuộc cuộc họp được yêu cầu");
        }

        return job;
    }

}
