package com.example.smartrec.model.dto;

import java.time.Instant;

/** Response của API verify, chỉ được tạo sau khi passcode hợp lệ. */
public record VerifySharePasscodeResponse(
        String accessToken, // Guest JWT; gồm loại GUEST, ID share link/meeting và scope đọc.
        Instant expiresAt // Hạn JWT theo UTC; không muộn hơn hạn của share link.
) {
}
