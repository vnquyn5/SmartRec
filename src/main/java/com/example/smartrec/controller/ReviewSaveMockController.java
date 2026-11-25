package com.example.smartrec.controller;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.exception.ErrorResponseDTO;
import com.example.smartrec.model.dto.ReviewSavePreviewResponse;
import com.example.smartrec.model.dto.ReviewSaveRequest;
import com.example.smartrec.service.ReviewSavePreviewService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/**
 * Cung cấp contract mock cho FE xem trước nội dung Review/Export.
 * Controller chỉ nhận request, gọi Service và trả response theo convention hiện có.
 */
@RestController
// Chỉ đăng ký route khi được bật tường minh; mặc định mock API không xuất hiện trong ứng dụng.
@ConditionalOnProperty(name = "smartrec.mock.review-save", havingValue = "true")
@RequiredArgsConstructor
@Tag(name = "Review", description = "Review save mock API")
public class ReviewSaveMockController {
    private final ReviewSavePreviewService reviewSavePreviewService;

    /**
     * Ví dụ dữ liệu tổng hợp để OpenAPI hiển thị cho FE và QA.
     * Các UUID và nội dung trong ví dụ là dữ liệu giả, không đại diện cho cuộc họp thật.
     */
    static final String SAMPLE_REQUEST = """
            {
              "meetingId": "00000000-0000-4000-8000-000000000001",
              "jobId": "00000000-0000-4000-8000-000000000002",
              "summary": {"executiveSummary": "Cuộc họp mẫu thống nhất lịch chạy thử."},
              "actionItems": [
                {"id": "00000000-0000-4000-8000-000000000003", "title": "Soạn checklist mẫu",
                 "assigneeName": "Thành viên A", "dueDate": "2026-11-27T10:00:00Z", "deadlineRaw": null},
                {"id": "00000000-0000-4000-8000-000000000004", "title": "Xác nhận lịch chạy thử",
                 "assigneeName": null, "dueDate": null, "deadlineRaw": "trước buổi họp tiếp theo"}
              ]
            }
            """;

    /** Response mẫu luôn được đánh dấu mock và không ngụ ý dữ liệu đã được lưu. */
    static final String SAMPLE_RESPONSE = "{\"mock\":true,\"exportPreview\":" + SAMPLE_REQUEST + "}";

    /**
     * Nhận bản Review cần xem trước.
     *
     * <p>{@code @Valid} kích hoạt kiểm tra constraint trên DTO trước khi gọi service.
     * Controller không tự lấy userId từ request: các service hiện có lấy user từ
     * ngữ cảnh xác thực và kiểm tra quyền trên meeting/job. Response HTTP 200 chỉ
     * cho biết preview đã được tạo, không biểu thị dữ liệu đã được lưu hoặc export.</p>
     *
     * @param request nội dung Review đã được Bean Validation kiểm tra
     * @return preview có cờ mock để phân biệt với kết quả lưu thật
     */
    @PostMapping(value = "/review-save", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Review save mock and export preview",
            description = "Returns a read-only preview. No Review is persisted and no export file is created. "
                    + "Enable with smartrec.mock.review-save=true. Replace synthetic IDs with IDs from an owned meeting/job.",
            requestBody = @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true, content = @Content(
                    mediaType = MediaType.APPLICATION_JSON_VALUE, schema = @Schema(implementation = ReviewSaveRequest.class),
                    examples = @ExampleObject(name = "Synthetic review request", value = SAMPLE_REQUEST))))
    @ApiResponses({
                @ApiResponse(responseCode = "200", description = "Preview only", content = @Content(
                        mediaType = MediaType.APPLICATION_JSON_VALUE, schema = @Schema(implementation = ReviewSavePreviewResponse.class),
                        examples = @ExampleObject(name = "Synthetic preview response", value = SAMPLE_RESPONSE))),
                @ApiResponse(responseCode = "400", description = "VALIDATION_ERROR", content = @Content(schema = @Schema(implementation = ErrorResponseDTO.class))),
                @ApiResponse(responseCode = "401", description = "Invalid bearer token"),
                @ApiResponse(responseCode = "403", description = "Authentication required or meeting access denied"),
                @ApiResponse(responseCode = "404", description = "Meeting or job not found", content = @Content(schema = @Schema(implementation = ErrorResponseDTO.class))),
                @ApiResponse(responseCode = "409", description = "Task does not belong to the meeting/job", content = @Content(schema = @Schema(implementation = ErrorResponseDTO.class))),
                @ApiResponse(responseCode = "500", description = "Unexpected backend error", content = @Content(schema = @Schema(implementation = ErrorResponseDTO.class)))
    })
    public ResponseEntity<ReviewSavePreviewResponse> saveReview(
            @Valid @RequestBody ReviewSaveRequest request) {
        return ResponseEntity.ok(reviewSavePreviewService.preview(request));
    }
}
