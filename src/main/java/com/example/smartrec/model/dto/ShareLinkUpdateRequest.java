package com.example.smartrec.model.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** PATCH dùng JsonNode để giữ khác biệt giữa field bị bỏ qua và field được gửi null. */
public record ShareLinkUpdateRequest(
        JsonNode expiresAt, // Bỏ qua: giữ nguyên; ISO-8601: đặt hạn; null: xóa hạn.
        JsonNode passcode // Bỏ qua: giữ nguyên; chuỗi: đặt/thay; null hoặc rỗng: gỡ passcode.
) {
}
