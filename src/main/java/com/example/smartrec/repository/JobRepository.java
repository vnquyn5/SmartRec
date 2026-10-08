package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.Job;
import com.example.smartrec.enums.JobStatus;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;

public interface JobRepository extends JpaRepository<Job,UUID> {

    List<Job>findByStatus(JobStatus status);

    Optional<Job> findFirstByMediaFileIdOrderByCreatedAtDesc(UUID mediaFileId);

    List<Job> findByStatusIn(List<JobStatus> statuses);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select j from Job j where j.id = :id")
    Optional<Job> findByIdForUpdate(@Param("id") UUID id);
    
} 
