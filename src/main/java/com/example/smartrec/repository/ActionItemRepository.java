package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.ActionItem;

public interface ActionItemRepository extends JpaRepository<ActionItem, UUID> {

    List<ActionItem> findByProcessingJobId(UUID processingJobId);

    void deleteByProcessingJobId(UUID processingJobId);
}
