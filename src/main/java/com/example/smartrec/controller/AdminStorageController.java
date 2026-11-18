package com.example.smartrec.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.AdminStorageObjectResponse;
import com.example.smartrec.model.dto.DeleteOrphanObjectsRequest;
import com.example.smartrec.model.dto.MinioObjectSummary;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.StorageCleanupRequest;
import com.example.smartrec.model.dto.StorageCleanupResponse;
import com.example.smartrec.model.dto.StorageOverviewResponse;
import com.example.smartrec.service.AdminStorageService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/admin/storage")
@RequiredArgsConstructor
public class AdminStorageController {
    private final AdminStorageService adminStorageService;

    @GetMapping("/overview")
    public ResponseEntity<StorageOverviewResponse> getOverview() {
        return ResponseEntity.ok(adminStorageService.getOverview());
    }

    @GetMapping("/objects")
    public ResponseEntity<PageResponse<AdminStorageObjectResponse>> listObjects(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false, defaultValue = "created_at,desc") String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "12") int size) {
        return ResponseEntity.ok(adminStorageService.listObjects(status, keyword, sort, page, size));
    }

    @GetMapping("/orphans")
    public ResponseEntity<List<MinioObjectSummary>> listOrphans() {
        return ResponseEntity.ok(adminStorageService.listOrphanObjects());
    }

    @PostMapping("/cleanup")
    public ResponseEntity<StorageCleanupResponse> runCleanup(@Valid @RequestBody StorageCleanupRequest request) {
        return ResponseEntity.ok(adminStorageService.runCleanup(request.getTaskType()));
    }

    @DeleteMapping("/objects/{id}")
    public ResponseEntity<Void> deleteObject(
            @PathVariable UUID id,
            @RequestParam(defaultValue = "false") boolean force) {
        adminStorageService.deleteStorageObject(id, force);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/orphans")
    public ResponseEntity<StorageCleanupResponse> deleteOrphans(
            @RequestBody DeleteOrphanObjectsRequest request) {
        return ResponseEntity.ok(adminStorageService.deleteOrphanObjects(
                request != null ? request.getObjectKeys() : List.of()));
    }
}

