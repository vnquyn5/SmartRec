package com.example.smartrec.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.MeetingAiResult;

public interface MeetingAiResultRepository extends JpaRepository<MeetingAiResult, UUID> {
    Optional<MeetingAiResult> findByMeetingId(UUID meetingId);
}
