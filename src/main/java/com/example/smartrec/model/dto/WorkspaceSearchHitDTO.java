package com.example.smartrec.model.dto;

import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * DTO gọn cho kết quả tìm kiếm và thao tác phát media trong Workspace. DTO chỉ trả UUID của hàng
 * transcript và thời điểm phát; không trả thông tin job nội bộ, URL media hay toàn bộ entity.
 */
@Getter
@AllArgsConstructor
@Schema(description = "Transcript match returned by Workspace search")
public class WorkspaceSearchHitDTO {
    /** UUID của hàng transcript đã lưu; FE dùng làm định danh bản ghi nguồn. */
    private UUID sourceId;

    /** Đoạn trích quanh từ khóa, lấy từ transcript được khớp. */
    private String snippet;

    /** Offset bắt đầu tính từ đầu bản ghi, đơn vị millisecond. */
    private Long startTimeMs;

    /** Null nếu transcript chưa được gán cho một speaker duy nhất. */
    private UUID speakerId;

    /** Tên speaker do người dùng đặt, nếu đã có. */
    private String speakerName;

    /** Nhãn diarization gốc, ví dụ SPEAKER_1, nếu có. */
    private String speakerLabel;
}
