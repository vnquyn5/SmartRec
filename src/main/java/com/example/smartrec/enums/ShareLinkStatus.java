package com.example.smartrec.enums;

public enum ShareLinkStatus {
    // Link được guest chấp nhận nếu còn hạn và meeting vẫn khả dụng.
    ACTIVE,
    // Owner đã thu hồi; giữ bản ghi để tra cứu lịch sử và audit.
    REVOKED
}
