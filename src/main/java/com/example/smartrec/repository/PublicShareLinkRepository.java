package com.example.smartrec.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.PublicShareLink;

public interface PublicShareLinkRepository extends JpaRepository<PublicShareLink, UUID> {
    // Trả danh sách của đúng meeting, link mới nhất đứng trước.
    List<PublicShareLink> findAllByMeetingIdOrderByCreatedAtDesc(UUID meetingId);

    // Ràng buộc đồng thời hai ID để ngăn lấy/sửa link thuộc meeting khác.
    Optional<PublicShareLink> findByIdAndMeetingId(UUID id, UUID meetingId);

    // Guest gửi token gốc; service hash nó trước khi gọi truy vấn này.
    Optional<PublicShareLink> findByTokenHash(String tokenHash);
}
