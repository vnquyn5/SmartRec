package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.SpeakerSegment;

public interface SpeakerSegmentRepository extends JpaRepository<SpeakerSegment, UUID> {

    // tim SpeakerSegment thuoc mot meeting sap xep theo startTime
    List<SpeakerSegment> findByMeetingIdOrderByStartTimeAsc(UUID meetingId);

    // tim SpeakerSegment dua tren meeting_id va speaker_label
    List<SpeakerSegment> findByMeetingIdAndSpeakerLabel(UUID meetingId, String speakerLabel);

    // xoa tat ca SpeakerSegment thuoc ve mot meeting (phuc vu idempotency khi callback retry)
    @Modifying
    @Transactional
    void deleteByMeetingId(UUID meetingId);
}
