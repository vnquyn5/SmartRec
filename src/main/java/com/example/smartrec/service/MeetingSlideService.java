package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.model.dto.MeetingSlideMetadataRequest;
import com.example.smartrec.model.dto.MeetingSlideResponse;

public interface MeetingSlideService {

    MeetingSlideResponse saveMetaData(MeetingSlideMetadataRequest request);
    List<MeetingSlideResponse>getSlidesByMeeting(UUID meetingId);
    List<MeetingSlideResponse> getSlidesByMeetingAndTime(UUID meetingId,Long fromMs, Long toMs);
}
