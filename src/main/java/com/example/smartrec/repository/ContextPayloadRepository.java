package com.example.smartrec.repository;



import java.util.Optional;

import java.util.UUID;



import org.springframework.data.jpa.repository.JpaRepository;



import com.example.smartrec.entity.ContextPayload;



public interface ContextPayloadRepository extends JpaRepository<ContextPayload,UUID> {

    Optional<ContextPayload>findByMeetingId(UUID meetingId);

}