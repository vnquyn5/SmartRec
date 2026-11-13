package com.example.smartrec.model.dto;

import java.time.Instant;

import jakarta.validation.constraints.Size;

/** Dữ liệu tùy chọn khi owner tạo link; bỏ body cũng tạo link không expiry/passcode. */
public record CreateShareLinkRequest(
        Instant expiresAt, // null nghĩa là link không đặt ngày hết hạn.
        @Size(min = 4, max = 72) String passcode // Passcode thô chỉ tồn tại trong request; service hash trước khi lưu.
) {
}
