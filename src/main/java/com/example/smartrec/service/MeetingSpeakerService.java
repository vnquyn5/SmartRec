package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;
import com.example.smartrec.model.dto.RenameSpeakerRequest;
import com.example.smartrec.model.dto.SpeakerSegmentResponse;

public interface MeetingSpeakerService {
    List<SpeakerSegmentResponse> getSpeakers(UUID meetingId);

    void renameSpeaker(UUID meetingId, RenameSpeakerRequest request);
    
} 
