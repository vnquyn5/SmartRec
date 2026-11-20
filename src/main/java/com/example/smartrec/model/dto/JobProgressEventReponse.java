package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

import lombok.Getter;
import lombok.Setter;

/** Event được broadcast trên /topic/jobs/{jobId} sau khi transaction chứa thay đổi Job commit. */
@Getter
@Setter
public class JobProgressEventReponse {

    /** Loại event: JOB_PROGRESS, JOB_COMPLETED hoặc JOB_FAILED. */
    private String eventType;

    /** Phiên bản schema payload để client xử lý tương thích khi format event thay đổi. */
    private String version;

    /** Job mà event phản ánh; đồng thời là ID nằm trong destination topic. */
    private UUID jobId;

    /** Meeting sở hữu Job, giúp client kiểm tra phạm vi dữ liệu đang theo dõi. */
    private UUID meetingId;

    /** ID riêng của lần phát event này; không thay thế sequence để so sánh thứ tự. */
    private UUID eventId;

    /** Số thứ tự tăng theo từng Job để phát hiện event cũ/bị bỏ lỡ khi client đồng bộ lại. */
    private Long sequence;

    /** Thời điểm tạo event theo UTC; dùng cho hiển thị/điều tra, không làm nguồn sắp thứ tự chính. */
    private Instant timestamp;

    /** Stage hiện tại, null khi không có stage đang chạy (ví dụ Job đã hoàn tất). */
    @JsonProperty("current_stage")
    private String currentStage;

    /** Trạng thái tổng thể hiện tại của Job. */
    private String status;

    /** Tỷ lệ stage SUCCESS trên tổng stage, ngoại trừ Job COMPLETED luôn là 100. */
    @JsonProperty("progress_percent")
    private Integer progressPercent;
}
