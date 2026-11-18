package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.WorkspaceSearchHitDTO;

/**
 * Hợp đồng tìm kiếm transcript mà Workspace hiển thị cho một meeting. Implementation phải kiểm
 * tra quyền truy cập meeting trước khi đọc transcript hoặc speaker và trả về DTO phân trang chung.
 */
public interface WorkspaceSearchService {
    /**
     * Tìm chuỗi con không phân biệt hoa thường trong transcript đang hoạt động của {@code meetingId}.
     * Nếu có bộ lọc speaker, UUID đó phải thuộc cùng meeting. Số trang theo quy ước bắt đầu từ 0
     * của Spring Data; page/size null sẽ dùng giá trị mặc định của service.
     *
     * @param meetingId meeting cần tìm
     * @param query nội dung tìm kiếm do người dùng nhập
     * @param speakerId bộ lọc speaker tùy chọn, giới hạn trong meeting
     * @param page số trang bắt đầu từ 0, hoặc null để dùng mặc định
     * @param size kích thước trang, hoặc null để dùng mặc định
     * @return các hit và metadata phân trang theo cấu trúc PageResponse hiện có
     */
    PageResponse<WorkspaceSearchHitDTO> searchMeetingTranscript(
            UUID meetingId,
            String query,
            UUID speakerId,
            Integer page,
            Integer size);
}
