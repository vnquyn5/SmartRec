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
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity 
@Table(name="meetings")
@Setter 
@Getter 
@Builder 
@AllArgsConstructor 
@NoArgsConstructor 

public class Meetings {

    @Id 
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column (name = "workspace_id" ,nullable=false)
    private UUID workspace_id;

    @Column (name = "media_file_id", unique = true,nullable = false)
    private UUID media_file_id;

    @Column (name = "title",nullable = false,length = 500)
    private String title;

    @Column (name = "processing_mode", nullable = true, length = 50)
    private String processing_mode;

    @Column (name = "status")
    private String status="DRAFT";

    @Column (name = "active_job_id")
    private UUID active_job_id;

    @CreationTimestamp 
    @Column (name = "created_at", updatable = false)
    private Instant created_at;

    @UpdateTimestamp 
    @Column (name = "updated_at")
    private Instant updated_at;

    @Column (name = "delete_at")
    private Instant deleted_at;
    
}
