package com.example.smartrec.service.impl;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;

import com.example.smartrec.entity.SpeakerSegment;
import com.example.smartrec.entity.Speaker;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.RenameSpeakerRequest;
import com.example.smartrec.model.dto.SpeakerSegmentResponse;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.service.MeetingSpeakerService;
import com.example.smartrec.service.MeetingService;
import org.springframework.transaction.annotation.Transactional;
import lombok.RequiredArgsConstructor;

@Service 
@RequiredArgsConstructor 
public class MeetingSpeakerServiceImpl implements MeetingSpeakerService {
    private final SpeakerRepository speakerRepository;
    private final MeetingSpeakerIdentityService speakerIdentityService;
    private final MeetingService meetingService;
    private static final Pattern GENERIC_SPEAKER_LABEL = Pattern.compile("(?i)^speaker[\\s-]*(\\d+)$");
    private static final Pattern RAW_SPEAKER_LABEL = Pattern.compile("(?i)^speaker_(\\d+)$");


    @Override 
    @Transactional(readOnly = true)
    public List<SpeakerSegmentResponse> getSpeakers(UUID meetingId){
        // kiem tra meeting xem co ton tai khong
        meetingService.getMeeting(meetingId);

        // lay segments va sap xep theo startTime tang dan
        MeetingSpeakerIdentityService.Mapping identities = speakerIdentityService.forMeeting(meetingId);
        return identities.timeline().stream()
                        .filter(MeetingSpeakerServiceImpl::isValidSegment)
                        .map(segment -> toResponse(segment, identities.forTimelineLabel(segment.getSpeakerLabel())))
                        .toList();
    }

    @Override 
    public void renameSpeaker(UUID meetingId, RenameSpeakerRequest request){
        meetingService.getMeeting(meetingId);
        Speaker speaker = request.getSpeakerId() == null
                ? findLegacySpeaker(meetingId, request.getSpeakerLabel())
                : speakerRepository.findById(request.getSpeakerId()).filter(item -> meetingId.equals(item.getMeetingId())).orElse(null);
        if (speaker == null) {
            throw new BusinessException(HttpStatus.NOT_FOUND,"SPEAKER_NOT_FOUND", "Không tìm thấy người nói");
        }
        String newName = request.getNewName().trim();
        speaker.setRealName(isDefaultName(newName, speaker.getAiLabel()) ? null : newName);
        speakerRepository.save(speaker);
    }

    private Speaker findLegacySpeaker(UUID meetingId, String speakerLabel) {
        if (speakerLabel == null || speakerLabel.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "SPEAKER_ID_REQUIRED", "Thiếu speakerId");
        }
        String normalized = speakerLabel.trim();
        MeetingSpeakerIdentityService.Identity identity = speakerIdentityService.forMeeting(meetingId)
                .forTimelineLabel(normalized);
        if (identity != null) {
            return speakerRepository.findById(identity.speakerId())
                    .filter(speaker -> meetingId.equals(speaker.getMeetingId())).orElse(null);
        }
        return speakerRepository.findByMeetingIdAndAiLabel(meetingId, normalized).stream()
                .findFirst()
                .orElseGet(() -> speakerRepository.findByMeetingId(meetingId).stream()
                        .filter(speaker -> speaker.getRealName() != null
                                && speaker.getRealName().equalsIgnoreCase(normalized))
                        .findFirst().orElse(null));
    }

    private SpeakerSegmentResponse toResponse(
            SpeakerSegment segment,
            MeetingSpeakerIdentityService.Identity identity) {
        return identity == null
                ? new SpeakerSegmentResponse(null, "Speaker chưa xác định", null, null, "Speaker chưa xác định",
                        segment.getStartTime(), segment.getEndTime())
                : new SpeakerSegmentResponse(identity.speakerId(), identity.displayName(), identity.aiLabel(),
                        identity.speakerIndex(), identity.displayName(),
                        segment.getStartTime(), segment.getEndTime());
    }

    private boolean isDefaultName(String name, String aiLabel) {
        int index = -1;
        Matcher raw = RAW_SPEAKER_LABEL.matcher(aiLabel == null ? "" : aiLabel.trim());
        Matcher generic = GENERIC_SPEAKER_LABEL.matcher(aiLabel == null ? "" : aiLabel.trim());
        try {
            if (raw.matches()) index = Integer.parseInt(raw.group(1)) + 1;
            else if (generic.matches()) index = Integer.parseInt(generic.group(1));
        } catch (NumberFormatException ignored) {
            index = -1;
        }
        return index > 0 && name.trim().toLowerCase(Locale.ROOT).equals(("Speaker " + index).toLowerCase(Locale.ROOT));
    }

    private static boolean isValidSegment(SpeakerSegment segment) {
        return segment.getSpeakerLabel() != null && !segment.getSpeakerLabel().isBlank()
                && segment.getStartTime() != null && segment.getStartTime() >= 0
                && segment.getEndTime() != null && segment.getEndTime() > segment.getStartTime();
    }
    
}
