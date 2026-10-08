package com.example.smartrec.service.impl;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;

import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.RenameSpeakerRequest;
import com.example.smartrec.model.dto.SpeakerSegmentResponse;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.MeetingSpeakerService;
import com.example.smartrec.service.MeetingService;
import org.springframework.transaction.annotation.Transactional;
import lombok.RequiredArgsConstructor;

@Service 
@RequiredArgsConstructor 
public class MeetingSpeakerServiceImpl implements MeetingSpeakerService {
    private final SpeakerSegmentRepository speakerSegmentRepository;
    private final MeetingService meetingService;


    @Override 
    @Transactional(readOnly = true)
    public List<SpeakerSegmentResponse> getSpeakers(UUID meetingId){
        // kiem tra meeting xem co ton tai khong
        meetingService.getMeeting(meetingId);

        // lay segments va sap xep theo startTime tang dan
        List<SpeakerSegment> segments = speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(meetingId);
        return segments.stream()
                        .filter(MeetingSpeakerServiceImpl::isValidSegment)
                        .map(segment -> new SpeakerSegmentResponse(segment.getSpeakerLabel(),segment.getStartTime(),segment.getEndTime())).toList();
    }

    @Override 
    public void renameSpeaker(UUID meetingId, RenameSpeakerRequest request){
        meetingService.getMeeting(meetingId);
        List<SpeakerSegment> segments = speakerSegmentRepository.findByMeetingIdAndSpeakerLabel(meetingId,request.getSpeakerLabel());
        if(segments.isEmpty()){
            throw new BusinessException(HttpStatus.NOT_FOUND,"SPEAKER_NOT_FOUND", "Không tìm thấy người nói");
        }

        for(SpeakerSegment segment : segments){
            segment.setSpeakerLabel(request.getNewName());
        }
        speakerSegmentRepository.saveAll(segments);
    }

    private static boolean isValidSegment(SpeakerSegment segment) {
        return segment.getSpeakerLabel() != null && !segment.getSpeakerLabel().isBlank()
                && segment.getStartTime() != null && segment.getStartTime() >= 0
                && segment.getEndTime() != null && segment.getEndTime() > segment.getStartTime();
    }
    
}
