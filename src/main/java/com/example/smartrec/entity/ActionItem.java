package com.example.smartrec.entity;

import java.time.Instant;
import java.util.UUID;
import java.util.List;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "action_items")
@Getter
@Setter
public class ActionItem {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "meeting_id", nullable = false)
    private UUID meetingId;

    @Column(name = "processing_job_id", nullable = false)
    private UUID processingJobId;

    @Column(name = "task_name", nullable = false, columnDefinition = "TEXT")
    private String taskName;

    @Column(name = "assignee_name")
    private String assigneeName;

    @Column(name = "assignee_user_id")
    private UUID assigneeUserId;

    @Column(name = "assignee_speaker_id")
    private UUID assigneeSpeakerId;

    @Column(name = "assignment_provenance", length = 32)
    private String assignmentProvenance;

    @Column(name = "due_date")
    private Instant dueDate;

    @Column(name = "deadline_raw", columnDefinition = "TEXT")
    private String deadlineRaw;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "source_transcript_id")
    private UUID sourceTranscriptId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "source_refs", columnDefinition = "jsonb")
    private List<String> sourceRefs;

    @Column(name = "is_verified", nullable = false)
    private boolean verified;
}
