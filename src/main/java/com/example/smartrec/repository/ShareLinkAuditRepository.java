package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.ShareLinkAudit;

public interface ShareLinkAuditRepository extends JpaRepository<ShareLinkAudit, UUID> {
    // Lấy lịch sử theo thứ tự thời gian; chỉ gọi sau khi service đã xác nhận quyền quản lý.
    List<ShareLinkAudit> findAllByShareLinkIdOrderByCreatedAtAsc(UUID shareLinkId);
}
