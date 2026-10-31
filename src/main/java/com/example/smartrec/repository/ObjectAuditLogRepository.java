package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.example.smartrec.entity.ObjectAuditLog;

@Repository
public interface ObjectAuditLogRepository extends JpaRepository<ObjectAuditLog, UUID> {

    List<ObjectAuditLog> findByObjectIdOrderByCreatedAtDesc(UUID objectId);
}
