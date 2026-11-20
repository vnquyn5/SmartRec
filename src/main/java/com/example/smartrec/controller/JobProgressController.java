package com.example.smartrec.controller;

import java.util.UUID;
import java.security.Principal;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.JobSnapshotDTO;
import com.example.smartrec.service.JobProgressAccessService;
import com.example.smartrec.service.JobProgressService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/jobs")
@RequiredArgsConstructor
public class JobProgressController {
    /** Dùng chung cách dựng snapshot cho cả REST recovery và yêu cầu STOMP. */
    private final JobProgressService jobProgressService;

    /** Giữ nguyên chính sách đọc Job dù client truy cập qua REST hay WebSocket. */
    private final JobProgressAccessService jobProgressAccessService;

    /**
     * Đọc snapshot hiện tại qua REST, thường dùng khi client tải trang hoặc khôi phục sau reconnect.
     *
     * <p>Endpoint đầy đủ là {@code GET /jobs/{jobId}/snapshot}. Access service kiểm tra user trước,
     * sau đó progress service đọc trạng thái và event sequence đã lưu để client đồng bộ với event stream.</p>
     *
     * @param jobId Job cần đọc
     * @param principal danh tính HTTP đã được JWT filter gắn vào request
     * @return snapshot hiện tại nếu user được phép đọc
     */
    @GetMapping("/{jobId}/snapshot")
    public ResponseEntity<JobSnapshotDTO> getSnapshot(
            @PathVariable UUID jobId,
            Principal principal) {

        // Xử lý null rõ ràng để access service trả lỗi UNAUTHORIZED theo cùng contract thay vì NPE.
        jobProgressAccessService.assertCanReadJob(jobId,
                principal == null ? null : principal.getName());

        // Không lấy dữ liệu từ cache/event gần nhất: snapshot đọc Job hiện tại và sequence đã persist.
        JobSnapshotDTO snapshot = jobProgressService.getSnapshot(jobId);

        return ResponseEntity.ok(snapshot);
    }

}
