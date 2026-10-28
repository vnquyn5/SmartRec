package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class MoveMeetingsRequest {
    @NotEmpty(message = "Vui lòng chọn ít nhất một tệp")
    private List<UUID> meetingIds;

    // null moves the selected files to the root folder.
    private UUID folderId;
}
