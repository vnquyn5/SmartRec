package com.example.smartrec.entity;

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


import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;

@Entity 
@Table ( name = "media_file")
@Getter 
@Setter 
@Builder 
@AllArgsConstructor 
@NoArgsConstructor 
public class MediaFile {
    
    
    @Id 
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspace_id;

    @Column(name = "uploaded_by", nullable = false)
    private UUID uploaded_by;

    @Column (name = "original_name",nullable = false, length = 500)
    private String original_name;

    @Column (name = "object_key",nullable = false, length = 1000)
    private String object_key;

    @Column (name = "multipart_upload_id", length = 255)
    private String multipart_upload_id;

    @Column (name = "mime_type",nullable = false, length = 100)
    private String mime_type;

    @Column (name = "file_size_bytes",nullable = false)
    private Long file_size_bytes;

    @Column (name = "duration_seconds")
    private Integer duration_seconds;

    @Column (name = "status")
    private String status="UPLOADING";

    
    @CreationTimestamp 
    @Column (name = "created_at", updatable = false)
    private Instant created_at;




    
}
