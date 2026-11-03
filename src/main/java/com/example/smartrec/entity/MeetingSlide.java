package com.example.smartrec.entity;

import java.util.List;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

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
@Table(name = "meeting_slides")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class MeetingSlide {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID slideId;

    @Column(name = "meeting_id", nullable = false)
    private UUID meetingId;

    @Column(name = "job_id", nullable = false)
    private UUID jobId;

    @Column(name = "timestamp_ms", nullable = false)
    private Long timestampMs;

    @Column(name = "object_key", nullable = false, length = 1024)
    private String objectKey;

    @Column(name = "ocr_text", columnDefinition = "TEXT")
    private String ocrText;

    @Column(name = "topic", length = 500)
    private String topic;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "keywords", columnDefinition = "jsonb")
    private List<String> keywords;
}