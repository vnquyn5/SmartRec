package com.example.smartrec.controller;

import java.util.UUID;

import org.springframework.core.io.InputStreamResource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.service.MeetingReportExportService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/meetings")
@RequiredArgsConstructor
@Tag(name = "Meetings")
public class ExportReportController {
    private final MeetingReportExportService exportService;

    @GetMapping("/{id}/export")
    @Operation(summary = "Download the reviewed meeting report in PDF or CSV format")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Meeting report attachment", content = {
                    @Content(mediaType = MediaType.APPLICATION_PDF_VALUE,
                            schema = @Schema(type = "string", format = "binary")),
                    @Content(mediaType = "text/csv", schema = @Schema(type = "string", format = "binary"))
            }),
            @ApiResponse(responseCode = "400", description = "Invalid meeting ID or format", content = @Content),
            @ApiResponse(responseCode = "401", description = "Invalid token", content = @Content),
            @ApiResponse(responseCode = "403", description = "Authentication required or meeting access denied",
                    content = @Content),
            @ApiResponse(responseCode = "404", description = "Meeting or reviewed summary not found", content = @Content),
            @ApiResponse(responseCode = "409", description = "Review evidence or reviewed data is incomplete",
                    content = @Content),
            @ApiResponse(responseCode = "500", description = "Report generation failed", content = @Content)
    })
    public ResponseEntity<InputStreamResource> exportReport(@PathVariable UUID id,
            @Parameter(description = "Report file format", schema = @Schema(allowableValues = {"pdf", "csv"}))
            @RequestParam String format) {
        var file = exportService.exportReport(id, format);
        // Báo cáo là dữ liệu nội bộ nên yêu cầu trình duyệt và proxy bỏ qua bộ đệm.
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.mimeType()))
                .contentLength(file.fileSizeBytes())
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(file.fileName()).build().toString())
                .body(new InputStreamResource(file.inputStream()));
    }
}
