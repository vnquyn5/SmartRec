package com.example.smartrec.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.WorkspaceMember;


public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember,UUID> {

    
    Optional<WorkspaceMember> findByUserId(UUID userId);
}