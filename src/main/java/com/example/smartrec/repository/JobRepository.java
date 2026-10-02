package com.example.smartrec.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.Job;
import com.example.smartrec.enums.JobStatus;

public interface JobRepository extends JpaRepository<Job,UUID> {

    List<Job>findByStatus(JobStatus status);
    
} 
