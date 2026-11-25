package com.example.smartrec.model.dto;

import java.util.List;
import java.util.UUID;

import com.example.smartrec.model.dto.ReviewSaveRequest.JsonText;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Dữ liệu review chỉ cho Summary và các Action Item đã tồn tại của Processing Job. */
@Getter
@Setter
@NoArgsConstructor
public class MeetingReviewSaveRequest {
    /** Job được review; service xác minh đây là Job hiện hành đã hoàn thành của Meeting trên path. */
    @NotNull
    private UUID jobId;

    /** Nội dung Summary đã được người dùng rà soát. */
    @NotNull
    @Valid
    private SummaryDraft summary;

    /** Chỉ cập nhật các Action Item có mặt trong danh sách; danh sách rỗng được chấp nhận. */
    @NotNull
    private List<@NotNull @Valid TaskDraft> actionItems;

    /** DTO chỉ nhận các field trong contract review-save. */
    @JsonAnySetter
    void rejectUnknown(String name, JsonNode value) {
        throw unknownField(name);
    }

    @Getter
    @Setter
    @NoArgsConstructor
    public static class SummaryDraft {
        /** Summary phải có nội dung dạng chuỗi. */
        @NotBlank
        @JsonDeserialize(using = JsonText.class)
        private String executiveSummary;

        /** Các field ngoài Summary đã duyệt bị từ chối khi đọc request. */
        @JsonAnySetter
        void rejectUnknown(String name, JsonNode value) {
            throw unknownField(name);
        }
    }

    @Getter
    @Setter
    @NoArgsConstructor
    public static class TaskDraft {
        /** ID chọn một Action Item sẵn có trong đúng Meeting và Job. */
        @NotNull
        private UUID id;

        /** Tên hiển thị của Action Item sau khi review. */
        @NotBlank
        @JsonDeserialize(using = JsonText.class)
        private String title;

        // JsonNode giữ được khác biệt giữa field bị bỏ qua và null tường minh để xóa giá trị.
        @Schema(type = "string", maxLength = 255,
                description = "Omit to keep the current value. Send null to clear it.", nullable = true)
        private JsonNode assigneeName;

        // Khi có offset, service chuyển thời điểm này về Instant trước khi lưu.
        @Schema(description = "ISO-8601 with an offset. Omit to keep the current value. Send null to clear it.",
                type = "string", format = "date-time", nullable = true)
        private JsonNode dueDate;

        // Giữ cùng quy tắc bỏ qua hoặc xóa như các field tùy chọn còn lại.
        @Schema(type = "string", description = "Omit to keep the current value. Send null to clear it.", nullable = true)
        private JsonNode deadlineRaw;

        /** Ngăn client cập nhật nhầm field hệ thống như status, sourceRefs hoặc speakerId. */
        @JsonAnySetter
        void rejectUnknown(String name, JsonNode value) {
            throw unknownField(name);
        }
    }

    private static IllegalArgumentException unknownField(String name) {
        return new IllegalArgumentException("Unknown review field: " + name);
    }
}
