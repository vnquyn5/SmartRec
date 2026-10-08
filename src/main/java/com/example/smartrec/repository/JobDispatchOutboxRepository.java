package com.example.smartrec.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.JobDispatchOutbox;

public interface JobDispatchOutboxRepository extends JpaRepository<JobDispatchOutbox, UUID> {
    List<JobDispatchOutbox> findTop100ByDispatchedAtIsNullAndAvailableAtLessThanEqualOrderByCreatedAtAsc(Instant now);
    Optional<JobDispatchOutbox> findTopByJobIdOrderByCreatedAtDesc(UUID jobId);
    boolean existsByJobIdAndDispatchedAtIsNull(UUID jobId);
}
