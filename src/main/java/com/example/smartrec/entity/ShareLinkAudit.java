package com.example.smartrec.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;

import com.example.smartrec.enums.ShareLinkAuditAction;

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
@Table(name = "share_link_audits")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor 
public class ShareLinkAudit {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id; // Khóa chính audit.

    // Lưu ID thay vì quan hệ JPA để audit không kéo thêm meeting/user graph khi truy vấn.
    @Column(name = "share_link_id", nullable = false)
    private UUID shareLinkId; // ID link được tác động; không tải JPA entity graph.

    @Column(name = "actor_id", nullable = false)
    private UUID actorId; // User thực hiện thao tác.

    @Enumerated(EnumType.STRING)
    @Column(name = "action", nullable = false, length = 30)
    private ShareLinkAuditAction action; // Loại thao tác thuộc enum audit.

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt; // Hibernate gán thời gian khi insert audit.

    @Column(name = "metadata", length = 500)
    private String metadata; // Metadata an toàn, không chứa token/passcode/hash.
}
