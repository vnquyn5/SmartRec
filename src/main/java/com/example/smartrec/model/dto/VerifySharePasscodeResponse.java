package com.example.smartrec.model.dto;

import java.time.Instant;

/** Grant tạm thời để guest gửi header ở các lần GET tiếp theo thay vì gửi lại passcode. */
public record VerifySharePasscodeResponse(
        String accessToken, // Secret ngẫu nhiên; Redis giữ bản ghi có TTL, không lưu vào database.
        Instant expiresAt // Thời điểm client cần verify lại.
) {
}
