package com.example.smartrec.service;

import com.example.smartrec.model.dto.ReviewSavePreviewResponse;
import com.example.smartrec.model.dto.ReviewSaveRequest;

/** Hợp đồng xử lý kiểm tra dữ liệu và tạo preview cho Review Save mock. */
public interface ReviewSavePreviewService {
    /**
     * Kiểm tra quyền và phạm vi dữ liệu, sau đó tạo response preview mà không ghi database.
     *
     * @param draft dữ liệu Review do client gửi
     * @return payload preview có cờ mock
     */
    ReviewSavePreviewResponse preview(ReviewSaveRequest draft);
}
