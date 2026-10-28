package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.MeetingSlide;

public interface MeetingSlideRepository extends JpaRepository<MeetingSlide,UUID> {
    // Lấy toàn bộ slide của meeting theo thứ tự thời gian.
    List<MeetingSlide> findByMeetingIdOrderByTimestampMsAsc(UUID meetingId);
    // Lọc slide trong khoảng thời gian của video.
    List<MeetingSlide>
    findByMeetingIdAndTimestampMsGreaterThanEqualAndTimestampMsLessThanEqualOrderByTimestampMsAsc(
            UUID meetingId,
            Long fromMs,
            Long toMs
    );
    // Kiểm tra slide đã thuộc meeting/job nào.
    boolean existsBySlideIdAndMeetingIdAndJobId(UUID slideId,UUID meetingId,UUID jobId);
    
} 