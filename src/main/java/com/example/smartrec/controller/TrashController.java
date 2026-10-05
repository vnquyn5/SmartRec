package com.example.smartrec.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.TrashFilterRequest;
import com.example.smartrec.model.dto.TrashMediaFileResponse;
import com.example.smartrec.service.TrashService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/media")
@RequiredArgsConstructor
public class TrashController {
    private final TrashService trashService;

    @GetMapping("/trash")
    public ResponseEntity<PageResponse<TrashMediaFileResponse>> findTrash(
            @ModelAttribute TrashFilterRequest request) {
        return ResponseEntity.ok(trashService.findTrash(request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<TrashMediaFileResponse> moveToTrash(@PathVariable UUID id) {
        return ResponseEntity.ok(trashService.moveToTrash(id));
    }

    @PostMapping("/{id}/restore")
    public ResponseEntity<TrashMediaFileResponse> restore(@PathVariable UUID id) {
        return ResponseEntity.ok(trashService.restore(id));
    }

    @DeleteMapping("/{id}/permanent")
    public ResponseEntity<Void> permanentDelete(@PathVariable UUID id) {
        trashService.permanentDelete(id);
        return ResponseEntity.noContent().build();
    }
}
