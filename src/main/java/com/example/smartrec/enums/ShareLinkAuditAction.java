package com.example.smartrec.enums;

public enum ShareLinkAuditAction {
    // Tạo link mới.
    CREATE,
    // Thay đổi hoặc gỡ ngày hết hạn.
    UPDATE_EXPIRY,
    // Thiết lập, thay thế hoặc gỡ passcode; audit không chứa giá trị passcode.
    UPDATE_PASSCODE,
    // Thu hồi link.
    REVOKE
}
