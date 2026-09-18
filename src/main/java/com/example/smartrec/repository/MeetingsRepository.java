package com.example.smartrec.repository;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import com.example.smartrec.entity.Meetings;

public interface MeetingsRepository extends JpaRepository <Meetings,UUID > {

    
}