package com.example.smartrec.entity;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "ai_usage")
@Setter
@Getter
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class AiUsage {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "job_id", nullable = false)
    private UUID jobId;

    @Column(name = "model_name", nullable = false)
    private String modelName;

    @Column(name = "model_version")
    private String modelVersion;

    @Column(name = "input_tokens")
    private Long inputTokens;

    @Column(name = "output_tokens")
    private Long outputTokens;

    @Column(name = "total_tokens")
    private Long totalTokens;

    @Column(name = "processing_time")
    private Long processingTime;

    @Column(name = "cpu_usage")
    private Long cpuUsage;

    @Column(name = "ram_usage")
    private Long ramUsage;

    @Column(name = "vram_usage")
    private Long vramUsage;

    @Column(name = "fallback_used", nullable = false)
    @Builder.Default
    private Boolean fallbackUsed = false;

    @Column(name = "estimated_cost")
    private Double estimatedCost;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

}