package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Snapshot đọc lại từ database để tải lần đầu hoặc khôi phục sau reconnect. */
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class JobSnapshotDTO {

    /** Định danh Job mà snapshot mô tả. */
    private UUID jobId;

    /** Meeting chứa Job; dùng đối chiếu với màn hình/luồng người dùng hiện tại. */
    private UUID meetingId;

    /** Trạng thái tổng thể mới nhất đã lưu. */
    private String status;

    /** Stage hiện tại; null khi Job không còn stage active. */
    @JsonProperty("current_stage")
    private String currentStage;

    /** Progress stage-level ở thời điểm snapshot được dựng. */
    @JsonProperty("progress_percent")
    private Integer progressPercent;

    /** Sequence mới nhất đã lưu để client bỏ qua event cũ hơn snapshot này. */
    private Long sequence;

    /** Thời điểm Job được cập nhật gần nhất theo database. */
    private Instant updatedAt;
}
