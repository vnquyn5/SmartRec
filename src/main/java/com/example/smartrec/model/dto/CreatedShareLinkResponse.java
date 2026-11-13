package com.example.smartrec.model.dto;

/** Chỉ response tạo mới có token gốc; list/detail cố ý dùng ShareLinkResponse riêng. */
public record CreatedShareLinkResponse(
        ShareLinkResponse shareLink, // Metadata quản lý thông thường, không chứa hash/secret.
        String token, // Secret chỉ trả một lần cho người vừa tạo link.
        String url // Đường dẫn public gồm context path và token.
) {
}
