package com.example.smartrec.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import com.example.smartrec.enums.ShareLinkStatus;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "public_share_links")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor 
public class PublicShareLink {
    // Token gốc không có field trong entity; chỉ tokenHash được persist để tra cứu link.
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id; // Khóa chính do Hibernate sinh.

    @Column(name = "meeting_id", nullable = false)
    private UUID meetingId; // Meeting mà guest được phép xem.

    @Column(name = "created_by", nullable = false)
    private UUID createdBy; // Owner tạo link, dùng làm thông tin kiểm toán.

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash; // SHA-256 hex của token 256-bit; token gốc không nằm trong entity.

    @Column(name = "passcode_hash", length = 100)
    private String passcodeHash; // BCrypt hash; null nghĩa là không yêu cầu passcode.

    // REVOKED là thu hồi thủ công; hết hạn được xác định trực tiếp từ expiresAt khi guest truy cập.
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private ShareLinkStatus status = ShareLinkStatus.ACTIVE; // Link mới được kích hoạt khi tạo.

    @Column(name = "expires_at")
    private Instant expiresAt; // null nghĩa là không hạn; kiểm tra mỗi lần guest truy cập.

    @Column(name = "revoked_at")
    private Instant revokedAt; // Thời điểm thu hồi; giữ record để bảo toàn lịch sử.

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt; // Hibernate gán lúc insert.

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt; // Hibernate cập nhật lúc insert/update.
}
