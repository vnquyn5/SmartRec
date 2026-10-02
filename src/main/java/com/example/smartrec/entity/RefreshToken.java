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
@Table (name = "refresh_tokens")
@Setter 
@Getter
@Builder 
@NoArgsConstructor 
@AllArgsConstructor 
public class RefreshToken {

    @Id 
    @GeneratedValue (strategy = GenerationType.UUID)
    private UUID id;

    @Column (name = "user_id", nullable = false)
    private UUID user;

    @Column (nullable = false, unique = true, length = 500)
    private String token;

    @Column(name = "expiry_date", nullable = false)
    private Instant expiryDate;

    @Column(nullable = false)
    private boolean revoked;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    
}
