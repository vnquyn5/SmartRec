package com.example.smartrec.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

import com.example.smartrec.entity.PendingMediaUpload;

public interface PendingMediaUploadRepository extends JpaRepository<PendingMediaUpload, UUID> {
    Optional<PendingMediaUpload> findByObjectKeyAndUserId(String objectKey, UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select pending from PendingMediaUpload pending where pending.objectKey = :objectKey and pending.userId = :userId")
    Optional<PendingMediaUpload> findByObjectKeyAndUserIdForUpdate(
            @Param("objectKey") String objectKey, @Param("userId") UUID userId);

    List<PendingMediaUpload> findTop100ByStatusAndExpiresAtBeforeOrderByExpiresAtAsc(String status, Instant now);
}
