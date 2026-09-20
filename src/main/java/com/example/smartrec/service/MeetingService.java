package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.dto.MeetingFilterRequest;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.PageResponse;

public interface MeetingService {
    PageResponse<MeetingResponseDTO> findMeetings(MeetingFilterRequest request);

    void deleteMeeting(UUID meetingId);
}