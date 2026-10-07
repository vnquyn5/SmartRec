package com.example.smartrec.service.impl;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.RenameSpeakerRequest;
import com.example.smartrec.model.dto.SpeakerSegmentResponse;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.service.MeetingSpeakerService;
import org.springframework.transaction.annotation.Transactional;
import lombok.RequiredArgsConstructor;

@Service 
@RequiredArgsConstructor 
public class MeetingSpeakerServiceImpl implements MeetingSpeakerService {
    private final MeetingRepository meetingRepository;
    private final SpeakerSegmentRepository speakerSegmentRepository;


    @Override 
    @Transactional(readOnly = true)
    public List<SpeakerSegmentResponse> getSpeakers(UUID meetingId){
        // kiem tra meeting xem co ton tai khong
        validateMeetingExists(meetingId);

        // lay segments va sap xep theo startTime tang dan
        List<SpeakerSegment> segments = speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(meetingId);
        return segments.stream()
                        .map(segment -> new SpeakerSegmentResponse(segment.getSpeakerLabel(),segment.getStartTime(),segment.getEndTime())).toList();
    }

    @Override 
    public void renameSpeaker(UUID meetingId, RenameSpeakerRequest request){
        validateMeetingExists(meetingId);
        List<SpeakerSegment> segments = speakerSegmentRepository.findByMeetingIdAndSpeakerLabel(meetingId,request.getSpeakerLabel());
        if(segments.isEmpty()){
            throw new BusinessException(HttpStatus.NOT_FOUND,"SPEAKER_NOT_FOUND", "Không tìm thấy người nói");
        }

        for(SpeakerSegment segment : segments){
            segment.setSpeakerLabel(request.getNewName());
        }
        speakerSegmentRepository.saveAll(segments);
    }

    private void validateMeetingExists(UUID meetingId){
        if(!meetingRepository.existsById(meetingId)){
            throw new BusinessException(HttpStatus.NOT_FOUND, "MEETING_NOT_FOUND", "Meeing không tồn tại");
        }
    }
    
}
