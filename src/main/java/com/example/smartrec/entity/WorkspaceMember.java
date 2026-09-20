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
@Table (name = "workspace_members")
@Setter 
@Getter 
@Builder
@AllArgsConstructor 
@NoArgsConstructor 
public class WorkspaceMember {

    @Id 
    @GeneratedValue (strategy = GenerationType.UUID)
    private UUID id;

    @Column (name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column (name = "user_id", nullable = false)
    private UUID userId;

    @Column (name = "role", length = 50)
    private String role;

    @Column (name = "joined_at")
    private Instant joinedAt;
    
}
