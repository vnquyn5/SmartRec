package com.example.smartrec.model.dto;

import java.time.Instant;
import java.util.UUID;

import com.example.smartrec.enums.ShareLinkAuditAction;

/** Dữ liệu lịch sử an toàn để hiển thị cho owner; không chứa secret. */
public record ShareLinkAuditResponse(
        UUID id, // ID dòng audit.
        UUID actorId, // Người thực hiện thao tác.
        ShareLinkAuditAction action, // Loại thao tác đã xảy ra.
        Instant createdAt, // Thời điểm do database/Hibernate gán.
        String metadata // Mô tả không nhạy cảm, ví dụ passcode được set/removed.
) {
}
