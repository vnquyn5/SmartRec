package com.example.smartrec.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Job;
import com.example.smartrec.enums.JobStatus;

public interface JobRepository extends JpaRepository<Job,UUID> {

    /** Scalar lease snapshot, deliberately bypassing the request's managed Job instance. */
    interface ExecutionLeaseView {
        UUID getJobId();
        UUID getMeetingId();
        UUID getExecutionId();
        Instant getLeaseExpiresAt();
        JobStatus getStatus();
    }

    @Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW)
    @Query("select j.id as jobId, j.meetingId as meetingId, j.executionId as executionId, "
            + "j.leaseExpiresAt as leaseExpiresAt, j.status as status from Job j where j.id = :id")
    Optional<ExecutionLeaseView> findExecutionLeaseById(@Param("id") UUID id);

    List<Job>findByStatus(JobStatus status);

    Optional<Job> findFirstByMediaFileIdOrderByCreatedAtDesc(UUID mediaFileId);

    List<Job> findByStatusIn(List<JobStatus> statuses);

    Page<Job> findByStatusInOrderByUpdatedAtAsc(List<JobStatus> statuses, Pageable pageable);

    @Query("select j.id from Job j where j.status in :statuses order by j.updatedAt asc")
    List<UUID> findIdsByStatusInOrderByUpdatedAtAsc(
            @Param("statuses") List<JobStatus> statuses, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select j from Job j where j.id = :id")
    Optional<Job> findByIdForUpdate(@Param("id") UUID id);
    
} 
