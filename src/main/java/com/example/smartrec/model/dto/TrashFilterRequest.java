package com.example.smartrec.model.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@Schema(description = "Filters and pagination for trash media files")
public class TrashFilterRequest {
    private Integer page = 0;
    private Integer size = 20;
    private String keyword;
    private String sort = "deleted_at,desc";
}
