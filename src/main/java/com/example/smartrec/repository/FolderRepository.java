package com.example.smartrec.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.Folder;

public interface FolderRepository extends JpaRepository<Folder, UUID> {
    List<Folder> findAllByUserIdOrderByNameAsc(UUID userId);

    List<Folder> findAllByUserIdAndParentIdIsNullOrderByNameAsc(UUID userId);

    List<Folder> findAllByUserIdAndParentIdOrderByNameAsc(UUID userId, UUID parentId);

    Optional<Folder> findByIdAndUserId(UUID id, UUID userId);

    boolean existsByUserIdAndNameKey(UUID userId, String nameKey);

    boolean existsByUserIdAndParentIdIsNullAndNameKey(UUID userId, String nameKey);

    boolean existsByUserIdAndParentIdAndNameKey(UUID userId, UUID parentId, String nameKey);

    boolean existsByUserIdAndNameKeyAndIdNot(UUID userId, String nameKey, UUID id);

    boolean existsByUserIdAndParentIdIsNullAndNameKeyAndIdNot(UUID userId, String nameKey, UUID id);

    boolean existsByUserIdAndParentIdAndNameKeyAndIdNot(UUID userId, UUID parentId, String nameKey, UUID id);
}
