package com.example.smartrec.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.Summary;

public interface SummaryRepository extends JpaRepository<Summary, UUID> {

    Optional<Summary> findByProcessingJobId(UUID processingJobId);
}
