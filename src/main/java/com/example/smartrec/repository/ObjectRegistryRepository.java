package com.example.smartrec.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import com.example.smartrec.entity.ObjectRegistry;
import com.example.smartrec.enums.ObjectState;

@Repository
public interface ObjectRegistryRepository extends JpaRepository<ObjectRegistry, UUID> {

    Optional<ObjectRegistry> findByBucketAndObjectKey(String bucket, String objectKey);

    boolean existsByBucketAndObjectKey(String bucket, String objectKey);

    List<ObjectRegistry> findByParentObjectId(UUID parentObjectId);

    List<ObjectRegistry> findByMeetingId(UUID meetingId);

    List<ObjectRegistry> findByJobId(UUID jobId);

    List<ObjectRegistry> findByOwnerId(UUID ownerId);

    List<ObjectRegistry> findByState(ObjectState state);

    @Query("SELECT o FROM ObjectRegistry o WHERE o.state = 'PENDING' AND o.createdAt < :cutoff")
    List<ObjectRegistry> findStalePendingObjects(@Param("cutoff") Instant cutoff);

    @Query("SELECT o FROM ObjectRegistry o WHERE NOT EXISTS (SELECT u.id FROM User u WHERE u.id = o.ownerId)")
    List<ObjectRegistry> findOrphanObjects();
}
