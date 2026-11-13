package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.example.smartrec.entity.MeetingStatus;

/** DTO allowlist cho guest; không serialize entity Meeting/MediaFile hay dữ liệu nội bộ. */
public record PublicMeetingShareResponse(
        UUID meetingId, // ID của meeting được link trỏ tới.
        String title, // Tiêu đề hiển thị công khai.
        MeetingStatus status, // Trạng thái xử lý meeting, không kèm job/error metadata.
        Instant createdAt // Thời điểm tạo meeting.
) {
}
