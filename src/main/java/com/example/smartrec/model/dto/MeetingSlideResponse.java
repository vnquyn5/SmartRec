package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.entity.MeetingSlide;

import lombok.Getter;
import lombok.Setter;

@Getter 
@Setter 

public class MeetingSlideResponse {
    private UUID slideId;
    private UUID meetingId;
    private UUID jobId;
    private Long timestampMs;
    private String objectKey;
    private String ocrText;
    private String topic;
    private List<String> keywords;

    public static MeetingSlideResponse fromEntity(
            MeetingSlide slide) {

        MeetingSlideResponse dto =
                new MeetingSlideResponse();

        dto.setSlideId(slide.getSlideId());
        dto.setMeetingId(slide.getMeetingId());
        dto.setJobId(slide.getJobId());
        dto.setTimestampMs(slide.getTimestampMs());
        dto.setObjectKey(slide.getObjectKey());
        dto.setOcrText(slide.getOcrText());
        dto.setTopic(slide.getTopic());
        dto.setKeywords(slide.getKeywords());

        return dto;
    }
}
