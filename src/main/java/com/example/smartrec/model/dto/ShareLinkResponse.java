package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.example.smartrec.enums.ShareLinkStatus;

/** DTO dùng cho list/detail/update; tuyệt đối không có token hay passcode hash. */
public record ShareLinkResponse(
        UUID id, // ID nội bộ dùng cho các thao tác quản lý tiếp theo.
        UUID meetingId, // Meeting sở hữu link.
        ShareLinkStatus status, // ACTIVE hoặc REVOKED; expiry được xét riêng theo expiresAt.
        Instant expiresAt, // null nghĩa là không tự hết hạn.
        Instant revokedAt, // null nếu chưa thu hồi.
        Instant createdAt, // Thời điểm tạo link.
        Instant updatedAt, // Lần cập nhật gần nhất.
        boolean hasPasscode // Chỉ báo có/không, không tiết lộ hash.
) {
}
