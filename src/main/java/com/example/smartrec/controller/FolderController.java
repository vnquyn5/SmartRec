package com.example.smartrec.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;

import com.example.smartrec.model.dto.FolderRequest;
import com.example.smartrec.model.dto.FolderResponse;
import com.example.smartrec.model.dto.MoveMeetingsRequest;
import com.example.smartrec.model.dto.MoveMeetingsResponse;
import com.example.smartrec.service.FolderService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/folders")
@RequiredArgsConstructor
@Validated
public class FolderController {
    private final FolderService folderService;

    @GetMapping
    public ResponseEntity<List<FolderResponse>> getFolders(@RequestParam(defaultValue = "all") String parentId) {
        return ResponseEntity.ok(folderService.getFolders(parentId));
    }

    @PostMapping
    public ResponseEntity<FolderResponse> createFolder(@Valid @RequestBody FolderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(folderService.createFolder(request));
    }

    @PatchMapping("/{folderId}")
    public ResponseEntity<FolderResponse> renameFolder(
            @PathVariable UUID folderId,
            @Valid @RequestBody FolderRequest request) {
        return ResponseEntity.ok(folderService.renameFolder(folderId, request));
    }

    @PostMapping("/move")
    public ResponseEntity<MoveMeetingsResponse> moveMeetings(@Valid @RequestBody MoveMeetingsRequest request) {
        return ResponseEntity.ok(folderService.moveMeetings(request));
    }
}
