package com.example.smartrec.repository;

import java.util.UUID;
import java.util.Optional;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.MeetingStatus;

public interface MeetingRepository extends JpaRepository<Meeting, UUID> {
    @Query("select m from Meeting m where m.media_file_id = :mediaFileId")
    Optional<Meeting> findByMediaFileId(@Param("mediaFileId") UUID mediaFileId);

    @Query(value = """
            select m from Meeting m
            where m.workspace_id = :workspaceId
              and exists (
                    select mf.id from MediaFile mf
                    where mf.id = m.media_file_id
                      and (mf.status is null or mf.status <> 'TRASHED')
              )
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
            """,
            countQuery = """
            select count(m) from Meeting m
            where m.workspace_id = :workspaceId
              and exists (
                    select mf.id from MediaFile mf
                    where mf.id = m.media_file_id
                      and (mf.status is null or mf.status <> 'TRASHED')
              )
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
    Page<Meeting> searchMeetings(
            @Param("workspaceId") UUID workspaceId,
            @Param("status") MeetingStatus status,
            @Param("keyword") String keyword,
            Pageable pageable);
}
