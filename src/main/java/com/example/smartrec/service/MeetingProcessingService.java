package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.dto.JobResponse;

public interface MeetingProcessingService {
    JobResponse processMeeting(UUID meetingId);
}
