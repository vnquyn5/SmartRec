package com.example.smartrec.repository;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.MeetingAuditLog;

public interface MeetingAuditLogRepository extends JpaRepository<MeetingAuditLog, UUID> {
}
