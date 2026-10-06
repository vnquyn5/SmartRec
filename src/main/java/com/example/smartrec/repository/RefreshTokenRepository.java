package com.example.smartrec.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.RefreshToken;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken,UUID> {
    Optional<RefreshToken> findByToken(String token);
} 
