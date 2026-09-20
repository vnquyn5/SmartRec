package com.example.smartrec.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.MeetingFilterRequest;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.service.MeetingService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;

@RestController
@RequestMapping("/meetings")
@AllArgsConstructor
@Tag(name = "Meetings", description = "Meeting file management APIs")
public class MeetingController {
    private final MeetingService meetingService;

    @GetMapping
    @Operation(summary = "List meeting files", description = "Returns the authenticated user's meeting files with pagination, status filtering and keyword search.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Meetings returned"),
            @ApiResponse(responseCode = "401", description = "Authentication required", content = @Content),
            @ApiResponse(responseCode = "400", description = "Invalid filter or pagination", content = @Content(schema = @Schema(hidden = true)))
    })
    public ResponseEntity<PageResponse<MeetingResponseDTO>> findMeetings(
            @ModelAttribute MeetingFilterRequest request) {
        return ResponseEntity.ok(meetingService.findMeetings(request));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete a meeting file", description = "Deletes the MinIO object first, then deletes the meeting and media records from PostgreSQL.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "Meeting file deleted"),
            @ApiResponse(responseCode = "404", description = "Meeting or media file not found", content = @Content),
            @ApiResponse(responseCode = "503", description = "MinIO operation failed", content = @Content)
    })
    public ResponseEntity<Void> deleteMeeting(
            @Parameter(name = "id", in = ParameterIn.PATH, required = true, description = "Meeting ID")
            @PathVariable UUID id) {
        meetingService.deleteMeeting(id);
        return ResponseEntity.noContent().build();
    }
}