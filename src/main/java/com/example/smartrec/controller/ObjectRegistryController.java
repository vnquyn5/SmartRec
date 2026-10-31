package com.example.smartrec.controller;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.entity.ObjectAuditLog;
import com.example.smartrec.model.dto.request.RegisterObjectRequest;
import com.example.smartrec.model.dto.request.TransitionStateRequest;
import com.example.smartrec.model.dto.response.ObjectLineageResponse;
import com.example.smartrec.model.dto.response.ObjectRegistryResponse;
import com.example.smartrec.service.ObjectRegistryService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/objects")
@RequiredArgsConstructor
@Tag(name = "Object Registry", description = "Canonical metadata and state machine APIs for storage objects")
public class ObjectRegistryController {

    private final ObjectRegistryService registryService;

    @PostMapping("/register")
    @Operation(summary = "Đăng ký object mới vào registry")
    public ResponseEntity<ObjectRegistryResponse> registerObject(
            @Valid @RequestBody RegisterObjectRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(registryService.registerObject(request));
    }

    @PostMapping("/{objectId}/transition")
    @Operation(summary = "Chuyển đổi trạng thái object qua State Machine")
    public ResponseEntity<ObjectRegistryResponse> transitionState(
            @PathVariable UUID objectId,
            @Valid @RequestBody TransitionStateRequest request) {
        return ResponseEntity.ok(registryService.transitionState(objectId, request));
    }

    @GetMapping("/{objectId}")
    @Operation(summary = "Xem chi tiết object theo ID")
    public ResponseEntity<ObjectRegistryResponse> getObjectById(@PathVariable UUID objectId) {
        return ResponseEntity.ok(registryService.getObjectById(objectId));
    }

    @GetMapping("/{objectId}/lineage")
    @Operation(summary = "Xem cây phả hệ (Parent/Children) của object")
    public ResponseEntity<ObjectLineageResponse> getObjectLineage(@PathVariable UUID objectId) {
        return ResponseEntity.ok(registryService.getObjectLineage(objectId));
    }

    @GetMapping("/{objectId}/audit-logs")
    @Operation(summary = "Xem lịch sử thay đổi trạng thái của object")
    public ResponseEntity<List<ObjectAuditLog>> getAuditLogs(@PathVariable UUID objectId) {
        return ResponseEntity.ok(registryService.getAuditLogs(objectId));
    }

    @GetMapping("/by-meeting/{meetingId}")
    @Operation(summary = "Truy vết tất cả object thuộc một meeting")
    public ResponseEntity<List<ObjectRegistryResponse>> getObjectsByMeeting(@PathVariable UUID meetingId) {
        return ResponseEntity.ok(registryService.getObjectsByMeetingId(meetingId));
    }

    @GetMapping("/stale-pending")
    @Operation(summary = "Lấy danh sách upload tạm quá hạn (mặc định > 24 giờ)")
    public ResponseEntity<List<ObjectRegistryResponse>> getStalePendingObjects(
            @RequestParam(defaultValue = "24") long olderThanHours) {
        return ResponseEntity.ok(registryService.getStalePendingObjects(Duration.ofHours(olderThanHours)));
    }
}
