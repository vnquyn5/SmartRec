package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.enums.StorageCleanupTaskType;
import com.example.smartrec.model.dto.AdminStorageObjectResponse;
import com.example.smartrec.model.dto.MinioObjectSummary;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.StorageCleanupResponse;
import com.example.smartrec.model.dto.StorageOverviewResponse;

public interface AdminStorageService {
    StorageOverviewResponse getOverview();

    PageResponse<AdminStorageObjectResponse> listObjects(
            String status,
            String keyword,
            String sort,
            int page,
            int size);

    List<MinioObjectSummary> listOrphanObjects();

    StorageCleanupResponse runCleanup(StorageCleanupTaskType taskType);

    void deleteStorageObject(UUID mediaFileId, boolean force);

    StorageCleanupResponse deleteOrphanObjects(List<String> objectKeys);
}

