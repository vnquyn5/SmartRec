package com.example.smartrec.repository;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.example.smartrec.entity.MediaFile;

import java.time.Instant;
import java.util.List;

public interface MediaFileRepository extends JpaRepository <MediaFile,UUID >{
    @Query("select mf from MediaFile mf where mf.object_key = :objectKey")
    Optional<MediaFile> findByObjectKey(@Param("objectKey") String objectKey);

    @Query("select mf from MediaFile mf where mf.object_key = :objectKey order by mf.created_at asc")
    List<MediaFile> findAllByObjectKey(@Param("objectKey") String objectKey);

    @Query("""
            select mf from MediaFile mf
            where mf.uploaded_by = :userId
              and mf.original_name = :originalName
              and mf.file_size_bytes = :fileSize
              and mf.status not in ('TRASHED', 'PURGED')
            order by mf.created_at asc
            """)
    List<MediaFile> findActiveDuplicates(
            @Param("userId") UUID userId,
            @Param("originalName") String originalName,
            @Param("fileSize") Long fileSize);

    @Query("""
            select mf from MediaFile mf
            where mf.uploaded_by = :userId
              and mf.quickFingerprint = :quickFingerprint
              and mf.status not in ('TRASHED', 'PURGED')
            order by mf.created_at asc
            """)
    List<MediaFile> findActiveByUserAndQuickFingerprint(
            @Param("userId") UUID userId,
            @Param("quickFingerprint") String quickFingerprint);

    @Query("""
            select mf from MediaFile mf
            where mf.uploaded_by = :userId
              and mf.quickFingerprint = :quickFingerprint
              and mf.fingerprintVersion = :fingerprintVersion
              and mf.status not in ('TRASHED', 'PURGED', 'INTEGRITY_FAILED')
            order by mf.created_at asc
            """)
    List<MediaFile> findActiveByUserAndQuickFingerprintVersion(
            @Param("userId") UUID userId,
            @Param("quickFingerprint") String quickFingerprint,
            @Param("fingerprintVersion") Integer fingerprintVersion);

    @Query("""
            select mf from MediaFile mf
            where mf.uploaded_by = :userId
              and mf.checksumSha256 = :checksumSha256
              and mf.status not in ('TRASHED', 'PURGED')
            order by mf.created_at asc
            """)
    List<MediaFile> findActiveByUserAndChecksumSha256(
            @Param("userId") UUID userId,
            @Param("checksumSha256") String checksumSha256);

    @Query("""
            select mf from MediaFile mf
            where mf.uploaded_by = :userId
              and mf.checksumSha256 = :checksumSha256
              and mf.id <> :excludedId
              and mf.status not in ('TRASHED', 'PURGED', 'INTEGRITY_FAILED')
            order by mf.created_at asc
            """)
    List<MediaFile> findActiveByUserAndChecksumSha256ExcludingId(
            @Param("userId") UUID userId,
            @Param("checksumSha256") String checksumSha256,
            @Param("excludedId") UUID excludedId);

    @Query("""
            select mf from MediaFile mf
            where mf.uploaded_by = :userId
              and mf.status = 'TRASHED'
              and (mf.purge_at is null or mf.purge_at > :now)
              and (
                    :keyword is null
                    or lower(mf.original_name) like lower(concat('%', cast(:keyword as string), '%'))
                    or lower(mf.mime_type) like lower(concat('%', cast(:keyword as string), '%'))
              )
            """)
    Page<MediaFile> searchTrash(
            @Param("userId") UUID userId,
            @Param("keyword") String keyword,
            @Param("now") Instant now,
            Pageable pageable);

    @Query("""
            select mf from MediaFile mf
            where mf.status = :status
              and mf.purge_at <= :now
            """)
    List<MediaFile> findExpiredTrash(@Param("status") String status, @Param("now") Instant now);
}
