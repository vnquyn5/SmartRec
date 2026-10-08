package com.example.smartrec.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import com.example.smartrec.entity.JobStage;
import com.example.smartrec.enums.PipelineStage;

public interface JobStageRepository extends JpaRepository<JobStage,UUID>{
    Optional<JobStage> findByJobIdAndStage(UUID jobId, PipelineStage stage);
    List<JobStage> findByJobIdOrderByStageAsc(UUID jobId);


    
} 