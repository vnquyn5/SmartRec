package com.example.smartrec.service.impl;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.MeetingSlide;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.MeetingSlideMetadataRequest;
import com.example.smartrec.model.dto.MeetingSlideResponse;
import com.example.smartrec.repository.MeetingSlideRepository;
import com.example.smartrec.service.MeetingSlideService;

import lombok.AllArgsConstructor;

@Service
@AllArgsConstructor
public class MeetingSlideServiceImpl implements MeetingSlideService {
    private final MeetingSlideRepository meetingSlideRepository;

    private final com.example.smartrec.repository.JobRepository jobRepository;
    private final com.example.smartrec.repository.MeetingRepository meetingRepository;

    @Override
    @Transactional
    public MeetingSlideResponse saveMetaData(MeetingSlideMetadataRequest request, UUID executionId) {
        if (request.getSlideId() == null || request.getMeetingId() == null || request.getJobId() == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "SLIDE_ID_REQUIRED", "Thiếu định danh slide/meeting/job");
        }
        var job = jobRepository.findByIdForUpdate(request.getJobId())
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND", "Không tìm thấy Job"));
        var meeting = meetingRepository.findById(request.getMeetingId())
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "MEETING_NOT_FOUND", "Không tìm thấy Meeting"));
        if (!request.getMeetingId().equals(job.getMeetingId())) {
            throw new BusinessException(HttpStatus.CONFLICT, "SLIDE_JOB_MEETING_MISMATCH", "Job không thuộc Meeting");
        }
        if (executionId == null || !executionId.equals(job.getExecutionId())
                || job.getLeaseExpiresAt() == null || !job.getLeaseExpiresAt().isAfter(java.time.Instant.now())
                || (job.getStatus() != com.example.smartrec.enums.JobStatus.PROCESSING
                    && job.getStatus() != com.example.smartrec.enums.JobStatus.RUNNING)
                || job.getCurrentStage() != com.example.smartrec.enums.PipelineStage.OUTPUT
                || !request.getJobId().equals(meeting.getActive_job_id())) {
            throw new BusinessException(HttpStatus.CONFLICT, "OCR_EXECUTION_LEASE_LOST", "Job không còn nhận metadata OCR");
        }
        String key = request.getObjectKey();
        String prefix = "meetings/" + request.getMeetingId() + "/jobs/" + request.getJobId() + "/ocr/";
        if (key == null || key.length() > 1024 || !key.startsWith(prefix)
                || key.length() == prefix.length() || key.contains("\\")
                || java.util.Arrays.stream(key.split("/", -1)).anyMatch(part -> part.isBlank() || part.equals(".") || part.equals(".."))
                || key.chars().anyMatch(Character::isISOControl)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_SLIDE_OBJECT_KEY", "Object key OCR không hợp lệ cho Job");
        }
        if (request.getTimestampMs() == null || request.getTimestampMs() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_TIME", "Timestamp không hợp lệ");
        }
        // tim slide ton tai de xu ly retry
        MeetingSlide slide = meetingSlideRepository.findById(request.getSlideId()).orElse(null);
        if (slide == null) {
            slide = new MeetingSlide();
            slide.setSlideId(request.getSlideId());
            slide.setMeetingId(request.getMeetingId());
            slide.setJobId(request.getJobId());
            slide.setTimestampMs(request.getTimestampMs());
            slide.setObjectKey(request.getObjectKey());
        } else {
            boolean sameIdentity = slide.getMeetingId().equals(request.getMeetingId())
                    && slide.getJobId().equals(request.getJobId())
                    && slide.getTimestampMs().equals(request.getTimestampMs())
                    && slide.getObjectKey().equals(request.getObjectKey());
            if (!sameIdentity) {
                // Nếu có ít nhất một trường định danh không giống nhau.
                throw new BusinessException(HttpStatus.CONFLICT, "SLIDE_ALREADY_EXISTS",
                        "Slide ID đã tồn tại với metadata định danh khác");
            }
        }
        // OCR rỗng là hợp lệ; không làm mất slide chỉ vì OCR thất bại
        slide.setOcrText(request.getOcrText());
        slide.setTopic(request.getTopic());
        slide.setKeywords(request.getKeywords() == null ? List.of() : request.getKeywords());
        MeetingSlide saved = meetingSlideRepository.save(slide);
        return MeetingSlideResponse.fromEntity(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public List<MeetingSlideResponse> getSlidesByMeeting(UUID meetingId) {
        return  meetingSlideRepository.findByMeetingIdOrderByTimestampMsAsc(meetingId)
                                      .stream()
                                      .map(MeetingSlideResponse :: fromEntity)// Chuyển từng MeetingSlide thành MeetingSlideResponse
                                      .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<MeetingSlideResponse> getSlidesByMeetingAndTime(UUID meetingId,Long fromMs, Long toMs){
        if(fromMs < 0 || fromMs>toMs){
            throw new BusinessException(HttpStatus.BAD_REQUEST, "ERR_INVALID_TIMES", "Khoảng thời gian không hợp lệ");
        }
        return  meetingSlideRepository.findByMeetingIdAndTimestampMsGreaterThanEqualAndTimestampMsLessThanEqualOrderByTimestampMsAsc(meetingId, fromMs, toMs)
                                      .stream()
                                      .map(MeetingSlideResponse :: fromEntity)
                                      .toList();
    }

}
