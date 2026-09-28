package com.example.smartrec.repository;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.example.smartrec.entity.MediaFile;

public interface MediaFileRepository extends JpaRepository <MediaFile,UUID >{
    @Query("select mf from MediaFile mf where mf.object_key = :objectKey")
    Optional<MediaFile> findByObjectKey(@Param("objectKey") String objectKey);
}
