package com.example.smartrec.repository;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.MediaFile;

public interface MediaFileRepository extends JpaRepository <MediaFile,UUID >{
}
