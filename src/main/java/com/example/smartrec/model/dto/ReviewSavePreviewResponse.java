package com.example.smartrec.model.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * Kết quả preview chỉ phục vụ tích hợp FE.
 *
 * <p>Đây là envelope của mock payload exporter: {@code mock=true} nhận diện dữ liệu
 * thử, còn {@code exportPreview} giữ nguyên contract Review đầu vào đã được kiểm tra.
 * DTO này không chứa đường dẫn/tệp export và không xác nhận thao tác ghi dữ liệu.</p>
 *
 * @param mock luôn là true để client nhận biết đây là phản hồi giả lập
 * @param exportPreview dữ liệu summary và task được gửi lên sau khi kiểm tra phạm vi
 */
@Schema(description = "Mock-only export preview; the review has not been persisted.")
public record ReviewSavePreviewResponse(boolean mock, ReviewSaveRequest exportPreview) {}
