package com.example.smartrec.service;

import java.util.Set;
import java.util.UUID;

public interface MeetingAuditLogService {
    /**
     * Ghi audit cho các trường Summary và ActionItem thực sự thay đổi khi lưu Review.
     * Gọi phương thức này bên trong transaction ghi của Review-Save. Callback thực hiện
     * thao tác lưu, để thay đổi Review và audit cùng commit hoặc cùng rollback.
     *
     * @param meetingId cuộc họp đang được chỉnh sửa
     * @param jobId job chứa kết quả AI cần review
     * @param actionItemIds các ActionItem hiện có được phép chỉnh sửa
     * @param saveReview thao tác backend dùng để lưu Review
     */
    void auditReviewSave(UUID meetingId, UUID jobId, Set<UUID> actionItemIds, Runnable saveReview);
}
