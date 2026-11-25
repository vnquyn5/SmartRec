package com.example.smartrec.service.impl;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.ReviewSavePreviewResponse;
import com.example.smartrec.model.dto.ReviewSaveRequest;
import com.example.smartrec.repository.ActionItemRepository;
import com.example.smartrec.service.JobService;
import com.example.smartrec.service.MeetingService;
import com.example.smartrec.service.ReviewSavePreviewService;
import lombok.RequiredArgsConstructor;

/**
 * Cài đặt nghiệp vụ cho endpoint xem trước Review Save.
 *
 * <p>Luồng này chỉ kiểm tra quyền truy cập và phạm vi dữ liệu đầu vào rồi trả lại
 * bản preview có cờ {@code mock}. Không cập nhật Summary/ActionItem và không tạo
 * tệp export; response thành công vì vậy không xác nhận dữ liệu đã được lưu.</p>
 *
 * <p>Việc kiểm tra quyền được giao cho các service hiện có để tuân theo quy tắc
 * xác định user hiện tại và quyền sở hữu meeting/job của hệ thống.</p>
 */
@Service
@RequiredArgsConstructor
public class ReviewSavePreviewServiceImpl implements ReviewSavePreviewService {
    /** Tải meeting bằng quy tắc hiện có, bao gồm kiểm tra quyền user hiện tại. */
    private final MeetingService meetingService;

    /** Tải job theo user đã đăng nhập; request không được tự chỉ định danh tính user. */
    private final JobService jobService;

    /** Chỉ đếm ID để xác nhận phạm vi task; repository này không được dùng để sửa task. */
    private final ActionItemRepository actionItems;

    /**
     * Kiểm tra bản nháp Review trước khi tạo response preview.
     *
     * <p>Thứ tự kiểm tra: quyền với meeting, quyền với job, liên kết job-meeting,
     * ID task trùng, rồi quyền sở hữu/phạm vi của từng task. Cách này tránh dùng
     * ID do client gửi để xác nhận dữ liệu ngoài phạm vi được phép.</p>
     *
     * @param draft nội dung bản nháp đã qua Bean Validation ở controller
     * @return preview được đánh dấu mock, không phải xác nhận đã lưu hoặc đã export
     * @throws BusinessException khi meeting/job không tồn tại hoặc user không có quyền,
     *         job không thuộc meeting, task bị lặp hoặc task không thuộc đúng phạm vi
     */
    @Override
    public ReviewSavePreviewResponse preview(ReviewSaveRequest draft) {
        // MeetingService tự lấy danh tính user từ Security Context và áp dụng kiểm tra quyền hiện có.
        meetingService.getMeeting(draft.meetingId());

        // Không nhận userId từ payload: JobService giới hạn việc tải job theo user hiện tại.
        var job = jobService.getJobForCurrentUser(draft.jobId());
        if (!draft.meetingId().equals(job.getMeetingId())) {
            // Job tồn tại nhưng gắn với meeting khác; dừng trước khi kiểm tra các task của job đó.
            throw new BusinessException(HttpStatus.NOT_FOUND, "MEETING_JOB_NOT_FOUND",
                    "Không tìm thấy Job thuộc cuộc họp");
        }

        // Tạo tập ID duy nhất để truy vấn repository một lần cho toàn bộ task trong request.
        Set<UUID> ids = draft.actionItems().stream()
                .map(ReviewSaveRequest.TaskDraft::id)
                .collect(Collectors.toSet());

        // Set loại phần tử trùng, nên đối chiếu kích thước với danh sách gốc để phát hiện request lặp ID.
        if (ids.size() != draft.actionItems().size()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Dữ liệu không hợp lệ",
                    List.of("actionItems: ID công việc bị lặp"));
        }

        // Đếm theo đồng thời meetingId và jobId; nếu số lượng không khớp thì có ID không thuộc phạm vi.
        // Danh sách rỗng không cần gọi repository vì không có task nào cần xác minh.
        if (!ids.isEmpty() && actionItems.countByMeetingIdAndProcessingJobIdAndIdIn(
                draft.meetingId(), draft.jobId(), ids) != ids.size()) {
            throw new BusinessException(HttpStatus.CONFLICT, "MEETING_RESULT_SCOPE_MISMATCH",
                    "Dữ liệu kết quả không thuộc Meeting/Job được yêu cầu");
        }

        // Trả lại bản nháp cho FE dựng preview; cờ mock phân biệt kết quả này với dữ liệu đã lưu.
        return new ReviewSavePreviewResponse(true, draft);
    }
}
