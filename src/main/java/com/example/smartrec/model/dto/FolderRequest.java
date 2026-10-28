package com.example.smartrec.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class FolderRequest {
    @NotBlank(message = "Tên thư mục không được để trống")
    @Size(max = 100, message = "Tên thư mục tối đa 100 ký tự")
    private String name;

    private UUID parentId;
}
