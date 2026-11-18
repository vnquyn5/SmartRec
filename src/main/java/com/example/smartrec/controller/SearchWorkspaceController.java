package com.example.smartrec.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.WorkspaceSearchHitDTO;
import com.example.smartrec.service.WorkspaceSearchService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;

/**
 * Lớp HTTP cho chức năng tìm kiếm transcript mà Workspace đang gắn với một meeting.
 * Controller chỉ nhận diện route và bind query parameter; kiểm tra quyền, trạng thái sẵn sàng,
 * truy vấn và ánh xạ response được giao cho {@link WorkspaceSearchService}.
 */
@RestController
@RequestMapping("/meetings")
@RequiredArgsConstructor
@Tag(name = "Workspace Search", description = "Search the active meeting transcript")
public class SearchWorkspaceController {
    private final WorkspaceSearchService workspaceSearchService;

    /**
     * Tìm trong transcript của job hiện đang hoạt động. Context path chung của API thêm `/api/v1`.
     *
     * @param id UUID của meeting lấy từ route
     * @param q từ khóa bắt buộc; service trim hai đầu và từ chối chuỗi rỗng
     * @param speakerId UUID speaker tùy chọn, phải thuộc meeting này
     * @param page số trang bắt đầu từ 0, mặc định là 0
     * @param size kích thước trang, mặc định 20 và service giới hạn tối đa 50
     * @return danh sách hit có phân trang, gồm ID nguồn và thời điểm seek theo millisecond
     */
    @GetMapping("/{id}/search")
    @Operation(summary = "Search a meeting transcript", description = "Searches the active Workspace transcript with an optional speaker filter. Results use the project's PageResponse shape and chronological ordering.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Transcript matches returned"),
            @ApiResponse(responseCode = "400", description = "Invalid query, speaker, or pagination"),
            @ApiResponse(responseCode = "401", description = "Authentication required"),
            @ApiResponse(responseCode = "403", description = "Meeting access denied"),
            @ApiResponse(responseCode = "404", description = "Meeting not found"),
            @ApiResponse(responseCode = "409", description = "Active transcript is not ready")
    })
    public ResponseEntity<PageResponse<WorkspaceSearchHitDTO>> searchMeeting(
            @Parameter(name = "id", in = ParameterIn.PATH, required = true, description = "Meeting UUID")
            @PathVariable UUID id,
            @Parameter(description = "Required search text; leading and trailing whitespace is trimmed")
            @RequestParam String q,
            @Parameter(description = "Optional speaker UUID from this meeting's transcript")
            @RequestParam(required = false) UUID speakerId,
            @Parameter(description = "Zero-based page number", example = "0")
            @RequestParam(defaultValue = "0") Integer page,
            @Parameter(description = "Page size from 1 to 50", example = "20")
            @RequestParam(defaultValue = "20") Integer size) {
        return ResponseEntity.ok(workspaceSearchService.searchMeetingTranscript(id, q, speakerId, page, size));
    }
}
