package com.example.smartrec.model.dto;

import com.example.smartrec.enums.StorageCleanupTaskType;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class StorageCleanupRequest {
    @NotNull(message = "Loại tác vụ dọn dẹp không được để trống")
    private StorageCleanupTaskType taskType;
}

