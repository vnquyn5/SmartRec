package com.example.smartrec.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import com.example.smartrec.enums.UploadSessionStatus;

import jakarta.annotation.Generated;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
@Table (name = "upload_sessions")
@Setter 
@Getter 
@Builder 
@AllArgsConstructor 
@NoArgsConstructor 
public class UploadSession {

    @Id 
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column (name = "user_id", nullable = false)
    private UUID userId ;

    @Column (name = "total_chunks", nullable = false)
    private Integer total_chunks;

    @Column (name = "received_chunks", nullable = false)
    private Integer received_chunks=0;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 50, nullable = false)
    @Builder.Default
     private UploadSessionStatus status = UploadSessionStatus.INITIATED;


    @CreationTimestamp 
    @Column (name = "created_at")
    private Instant created_at;

    @UpdateTimestamp 
    @Column (name = "updated_at")
    private Instant updated_at ;

    
}
