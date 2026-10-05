package com.example.smartrec.model.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@Schema(description = "Filters and pagination for the meeting list")
public class MeetingFilterRequest {
    @Schema(description = "Zero-based page index", example = "0", defaultValue = "0")
    private Integer page = 0;

    @Schema(description = "Page size", example = "20", defaultValue = "20")
    private Integer size = 20;

    @Schema(description = "Meeting status", allowableValues = { "PENDING", "PROCESSING", "COMPLETED", "FAILED" })
    private String status;

    @Schema(description = "Search by meeting title or original file name", example = "weekly sync")
    private String keyword;

    @Schema(description = "Sort expression: field,direction", example = "created_at,desc", defaultValue = "created_at,desc")
    private String sort = "created_at,desc";
}