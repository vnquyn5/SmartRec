package com.example.smartrec.model.dto;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Dữ liệu đầu vào cho mock Review Save, dùng tên trường hiện có trong kết quả Meeting.
 *
 * @param meetingId meeting được yêu cầu xem trước
 * @param jobId job tạo ra Summary và ActionItem
 * @param summary phần Executive Summary
 * @param actionItems các task được gửi trong bản preview; danh sách rỗng được chấp nhận
 */
@Schema(description = "Read-only mock review preview using fields from the meeting results API.")
public record ReviewSaveRequest(
        @NotNull UUID meetingId,
        @NotNull UUID jobId,
        @NotNull @Valid SummaryDraft summary,
        @NotNull List<@NotNull @Valid TaskDraft> actionItems) {

    /**
     * Phần Executive Summary do người dùng review.
     *
     * <p>{@code @NotBlank} từ chối chuỗi rỗng hoặc chỉ có khoảng trắng. Bộ đọc JSON
     * riêng cũng yêu cầu giá trị JSON phải là string, tránh âm thầm đổi số/boolean
     * thành text trước khi validation chạy.</p>
     */
    public record SummaryDraft(@NotBlank @JsonDeserialize(using = JsonText.class) String executiveSummary) {}

    /**
     * Các trường review hiển thị từ một ActionItem đã tồn tại.
     * ID được dùng để Service xác minh task thuộc đúng meeting và job.
     */
    /**
     * Bản chỉnh sửa preview cho một ActionItem đã có trong kết quả meeting.
     *
     * <p>{@code id} là ID bản ghi để backend kiểm tra phạm vi meeting/job; contract
     * hiện tại không nhận ID do client tự tạo và không tạo task mới. {@code title}
     * bắt buộc có nội dung. {@code assigneeName}, {@code dueDate} và {@code deadlineRaw}
     * là thông tin tùy chọn được giữ theo các kiểu dữ liệu hiện có của ActionItem.</p>
     */
    public record TaskDraft(
            @NotNull UUID id,
            @NotBlank @JsonDeserialize(using = JsonText.class) String title,
            @Size(max = 255) @JsonDeserialize(using = JsonText.class) String assigneeName,
            @Schema(type = "string", format = "date-time", nullable = true)
            @JsonDeserialize(using = JsonText.class) String dueDate,
            @JsonDeserialize(using = JsonText.class) String deadlineRaw) {
        public TaskDraft {
            // Chuỗi tùy chọn rỗng/khoảng trắng được coi như chưa nhập, thống nhất với giá trị null.
            assigneeName = blankToNull(assigneeName);
            deadlineRaw = blankToNull(deadlineRaw);
            if (dueDate != null) {
                // Chỉ nhận ISO-8601 có offset; lưu biểu diễn UTC để các múi giờ cùng về một thời điểm.
                dueDate = OffsetDateTime.parse(dueDate).toInstant().toString();
            }
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * Chặn Jackson tự ép số hoặc boolean thành chuỗi trong các trường text.
     * Giá trị sai kiểu được chuyển thành lỗi đọc request và dùng error format chung.
     */
    public static class JsonText extends JsonDeserializer<String> {
        @Override
        public String deserialize(JsonParser parser, DeserializationContext context) throws IOException {
            if (!parser.hasToken(JsonToken.VALUE_STRING)) {
                return context.reportInputMismatch(String.class, "Expected a JSON string");
            }
            return parser.getText();
        }
    }
}
