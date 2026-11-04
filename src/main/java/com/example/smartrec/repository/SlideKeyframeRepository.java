package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.SlideKeyframe;

public interface SlideKeyframeRepository extends JpaRepository<SlideKeyframe,UUID> {
    List<SlideKeyframe> findByMeetingIdOrderByTimestampMsAsc(UUID meetingId);
}
