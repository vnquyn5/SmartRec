package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.dto.MeetingReviewSaveRequest;

/** Xử lý lưu Summary và Action Item sau khi người dùng review Meeting. */
public interface MeetingReviewService {
    /** Lưu thay đổi thuộc Meeting cùng Audit Log trong một transaction. */
    void saveReview(UUID meetingId, MeetingReviewSaveRequest request);
}
