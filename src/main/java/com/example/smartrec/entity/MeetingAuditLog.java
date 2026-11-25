package com.example.smartrec.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "meeting_audit_logs")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class MeetingAuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "meeting_id", nullable = false, updatable = false)
    private UUID meetingId;

    @Column(name = "event_type", nullable = false, updatable = false, columnDefinition = "TEXT")
    private String eventType;

    // Các bản ghi audit cũ có thể chưa có thông tin chi tiết từng trường.
    @Column(name = "entity_type", updatable = false, columnDefinition = "TEXT")
    private String entityType;

    @Column(name = "entity_id", updatable = false)
    private UUID entityId;

    @Column(name = "field_name", updatable = false, columnDefinition = "TEXT")
    private String fieldName;

    @Column(name = "old_value", updatable = false, columnDefinition = "TEXT")
    private String oldValue;

    @Column(name = "new_value", updatable = false, columnDefinition = "TEXT")
    private String newValue;

    @Column(name = "actor_id", updatable = false)
    private UUID actorId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
