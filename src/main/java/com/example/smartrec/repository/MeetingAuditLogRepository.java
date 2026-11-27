package com.example.smartrec.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.MeetingAuditLog;

public interface MeetingAuditLogRepository extends JpaRepository<MeetingAuditLog, UUID> {

    /** Lấy thay đổi review gần nhất đã lưu để chọn đúng phiên bản dữ liệu. */
    Optional<MeetingAuditLog> findFirstByMeetingIdAndEventTypeAndJobIdIsNotNullOrderByCreatedAtDesc(
            UUID meetingId, String eventType);

    /** Lấy các field change thuộc chính xác Meeting và Processing Job đã review. */
    List<MeetingAuditLog> findByMeetingIdAndJobIdAndEventTypeOrderByCreatedAtDesc(
            UUID meetingId, UUID jobId, String eventType);
}
