package com.example.smartrec.repository;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.ActionItem;

public interface ActionItemRepository extends JpaRepository<ActionItem, UUID> {

    List<ActionItem> findByProcessingJobId(UUID processingJobId);

    /**
     * Đếm các task khớp cả meeting, job và ID để phát hiện task ngoài phạm vi request.
     * Dùng derived query theo convention Spring Data hiện có.
     */
    long countByMeetingIdAndProcessingJobIdAndIdIn(UUID meetingId, UUID processingJobId, Set<UUID> ids);

    void deleteByProcessingJobId(UUID processingJobId);
}
