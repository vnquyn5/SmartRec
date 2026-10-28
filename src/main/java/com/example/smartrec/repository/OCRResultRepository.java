package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.OCRResult;

public interface OCRResultRepository extends JpaRepository<OCRResult, UUID> {
    List<OCRResult> findByKeyframeId(UUID keyframeId);
    
} 