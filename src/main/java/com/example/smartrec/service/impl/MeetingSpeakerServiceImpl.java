package com.example.smartrec.service.impl;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.exception.ResourceNotFoundException;
import com.example.smartrec.model.dto.RenameSpeakerRequest;
import com.example.smartrec.model.dto.SpeakerSegmentResponse;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.SpeakerSegmentRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.MeetingSpeakerService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class MeetingSpeakerServiceImpl implements MeetingSpeakerService {

    private final MeetingRepository meetingRepository;
    private final SpeakerSegmentRepository speakerSegmentRepository;
    private final UserRepository userRepository;

    @Override
    @Transactional(readOnly = true)
    public List<SpeakerSegmentResponse> getSpeakers(UUID meetingId) {
        validateMeetingOwnership(meetingId);

        List<SpeakerSegment> segments = speakerSegmentRepository.findByMeetingIdOrderByStartTimeAsc(meetingId);
        return segments.stream()
                .map(segment -> new SpeakerSegmentResponse(segment.getSpeakerLabel(), segment.getStartTime(), segment.getEndTime()))
                .toList();
    }

    @Override
    @Transactional
    public void renameSpeaker(UUID meetingId, RenameSpeakerRequest request) {
        validateMeetingOwnership(meetingId);

        List<SpeakerSegment> segments = speakerSegmentRepository.findByMeetingIdAndSpeakerLabel(meetingId, request.getSpeakerLabel());
        if (segments.isEmpty()) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "SPEAKER_NOT_FOUND", "Không tìm thấy người nói");
        }

        for (SpeakerSegment segment : segments) {
            segment.setSpeakerLabel(request.getNewName());
        }
        speakerSegmentRepository.saveAll(segments);
    }

    private Meeting validateMeetingOwnership(UUID meetingId) {
        User currentUser = getCurrentUser();
        return meetingRepository.findById(meetingId)
                .filter(item -> item.getWorkspace_id().equals(currentUser.getId()))
                .orElseThrow(() -> new ResourceNotFoundException(
                        "MEETING_NOT_FOUND", "Không tìm thấy cuộc họp hoặc bạn không có quyền truy cập"));
    }

    private User getCurrentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Yêu cầu đăng nhập");
        }
        String identifier = authentication.getName();
        return userRepository.findByEmail(identifier)
                .or(() -> userRepository.findByPhone(identifier))
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "Không tìm thấy người dùng đăng nhập"));
    }
}
