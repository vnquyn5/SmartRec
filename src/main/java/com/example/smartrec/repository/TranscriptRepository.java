package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.Transcript;

public interface TranscriptRepository extends JpaRepository<Transcript, UUID> {
 
    List<Transcript> findByMeetingIdOrderByStartTimeMsAsc(UUID meetingId);

    List<Transcript> findByProcessingJobIdOrderByStartTimeMsAsc(UUID processingJobId);
}