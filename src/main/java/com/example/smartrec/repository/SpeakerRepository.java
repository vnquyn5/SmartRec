package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.Speaker;

public interface SpeakerRepository extends JpaRepository<Speaker, UUID> {

    List<Speaker> findByMeetingIdAndAiLabel(
            UUID meetingId,
            String aiLabel
    );

    List<Speaker> findByMeetingId(UUID meetingId);
}
