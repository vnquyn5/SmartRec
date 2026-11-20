package com.example.smartrec.service;

import java.util.UUID;

/**
 * Chính sách dùng chung để quyết định user có được đọc snapshot hoặc đăng ký topic của một Job hay không.
 * Các entry point REST và STOMP gọi cùng service để không tạo hai cách phân quyền khác nhau.
 */
public interface JobProgressAccessService {
    /** Kiểm tra quyền theo Job khi caller chỉ có jobId, ví dụ lúc subscribe /topic/jobs/{jobId}. */
    void assertCanReadJob(UUID jobId, String principalName);

    /**
     * Kiểm tra danh tính, quan hệ Job/Meeting và quyền đọc Meeting.
     * Dùng khi client gửi cả hai ID, để meetingId giả hoặc Job thuộc Meeting khác không được chấp nhận.
     */
    void assertCanReadJob(UUID meetingId, UUID jobId, String principalName);
}
