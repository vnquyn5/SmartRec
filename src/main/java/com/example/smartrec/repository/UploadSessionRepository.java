package com.example.smartrec.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.UploadSession;
import com.example.smartrec.enums.UploadSessionStatus;

public interface UploadSessionRepository extends JpaRepository<UploadSession, UUID> {

    Optional<UploadSession> findByIdAndUserId(UUID id, UUID userId);

    @Modifying
    @Transactional
    @Query("""
            update UploadSession session
            set session.receivedChunks = :receivedChunks,
                session.status = :status
            where session.id = :id
                and session.userId = :userId
            """)
    int updateProgressForUser(
            @Param("id") UUID id,
            @Param("userId") UUID userId,
            @Param("receivedChunks") Integer receivedChunks,
            @Param("status") UploadSessionStatus status);

    @Modifying
    @Transactional
    @Query("""
            update UploadSession session
            set session.status = :status
            where session.id = :id
                and session.userId = :userId
            """)
    int updateStatusForUser(
            @Param("id") UUID id,
            @Param("userId") UUID userId,
            @Param("status") UploadSessionStatus status);
}
