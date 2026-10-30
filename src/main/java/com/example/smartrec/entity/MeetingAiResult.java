package com.example.smartrec.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "meeting_ai_results", uniqueConstraints = @UniqueConstraint(name = "uq_meeting_ai_results_meeting", columnNames = "meeting_id"))
@Getter
@Setter
@NoArgsConstructor
public class MeetingAiResult {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "meeting_id", nullable = false, unique = true)
    private UUID meetingId;

    @Column(name = "processing_job_id", nullable = false)
    private UUID processingJobId;

    @Column(name = "results_json", nullable = false, columnDefinition = "text")
    private String resultsJson;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
}
