package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.SpeakerSegment;

public interface SpeakerSegmentRepository extends JpaRepository<SpeakerSegment,UUID> {

    // tim SpeakerSegment thuoc mot meeting
    List<SpeakerSegment> findByMeetingIdOrderByStartTimeAsc(UUID meetingId);


    // tim SpeakerSegment dua tren 2 tieu chi ,
    // meeting_id: Segment thuoc meeting nao
    // speaker_label: thuoc speaker nao
    List<SpeakerSegment> findByMeetingIdAndSpeakerLabel(UUID meetingId, String speakerLabel);

    void deleteByMeetingId(UUID meetingId);
    
}
