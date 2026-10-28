package com.example.smartrec.repository;

import java.util.UUID;
import java.util.Optional;
import java.util.Collection;
import java.util.List;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.query.Param;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import jakarta.persistence.LockModeType;

public interface MeetingRepository extends JpaRepository<Meeting, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from Meeting m where m.id = :meetingId")
    Optional<Meeting> findByIdForUpdate(@Param("meetingId") UUID meetingId);

    @Query("select m from Meeting m where m.media_file_id = :mediaFileId")
    Optional<Meeting> findByMediaFileId(@Param("mediaFileId") UUID mediaFileId);

    @Query(value = """
            select new com.example.smartrec.model.dto.MeetingResponseDTO(
                m.id, m.title, m.status, m.media_file_id,
                mf.original_name, mf.mime_type, mf.file_size_bytes, mf.duration_seconds,
                m.created_at, m.updated_at, m.active_job_id
            )
            from Meeting m
            join MediaFile mf on mf.id = m.media_file_id
            where m.workspace_id = :workspaceId
              and (mf.status is null or mf.status <> 'TRASHED')
              and (:folderMode = 0
                   or (:folderMode = 1 and m.folder_id is null)
                   or (:folderMode = 2 and m.folder_id = :folderId))
              and (:status is null or m.status = :status)
              and (
                    :keyword is null
                    or lower(m.title) like lower(concat('%', cast(:keyword as string), '%'))
                    or lower(mf.original_name) like lower(concat('%', cast(:keyword as string), '%'))
              )
            """,
            countQuery = """
            select count(m) from Meeting m
            where m.workspace_id = :workspaceId
              and exists (
                    select mf.id from MediaFile mf
                    where mf.id = m.media_file_id
                      and (mf.status is null or mf.status <> 'TRASHED')
              )
              and (:folderMode = 0
                   or (:folderMode = 1 and m.folder_id is null)
                   or (:folderMode = 2 and m.folder_id = :folderId))
              and (:status is null or m.status = :status)
              and (
                    :keyword is null
                    or lower(m.title) like lower(concat('%', cast(:keyword as string), '%'))
                    or exists (
                        select mf.id from MediaFile mf
                        where mf.id = m.media_file_id
                          and lower(mf.original_name) like lower(concat('%', cast(:keyword as string), '%'))
                    )
              )
            """)
    Page<MeetingResponseDTO> searchMeetings(
            @Param("workspaceId") UUID workspaceId,
            @Param("folderId") UUID folderId,
            @Param("folderMode") int folderMode,
            @Param("status") MeetingStatus status,
            @Param("keyword") String keyword,
            Pageable pageable);

    @Query("select m from Meeting m where m.workspace_id = :userId and m.id in :meetingIds")
    List<Meeting> findAllOwnedMeetingsByIds(
            @Param("userId") UUID userId,
            @Param("meetingIds") Collection<UUID> meetingIds);
}
