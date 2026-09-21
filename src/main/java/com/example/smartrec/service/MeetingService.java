package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.dto.MeetingFilterRequest;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.RenameFileRequest;

public interface MeetingService {
    PageResponse<MeetingResponseDTO> findMeetings(MeetingFilterRequest request);

    void deleteMeeting(UUID meetingId);

    MeetingResponseDTO renameMeeting(UUID meetingId, RenameFileRequest request);
}