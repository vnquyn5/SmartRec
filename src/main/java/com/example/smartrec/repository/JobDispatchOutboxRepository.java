package com.example.smartrec.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.example.smartrec.entity.JobDispatchOutbox;

public interface JobDispatchOutboxRepository extends JpaRepository<JobDispatchOutbox, UUID> {
    List<JobDispatchOutbox> findTop100ByDispatchedAtIsNullOrderByAvailableAtAscCreatedAtAsc();
    List<JobDispatchOutbox> findTop100ByDispatchedAtIsNullAndAvailableAtLessThanEqualOrderByAvailableAtAscCreatedAtAsc(Instant now);
    Optional<JobDispatchOutbox> findTopByJobIdOrderByCreatedAtDesc(UUID jobId);
    boolean existsByJobIdAndDispatchedAtIsNull(UUID jobId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select outbox from JobDispatchOutbox outbox where outbox.id = :id")
    Optional<JobDispatchOutbox> findByIdForUpdate(@Param("id") UUID id);
}
