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

    @Override
    @Transactional
    public MeetingSlideResponse saveMetaData(MeetingSlideMetadataRequest request) {
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
