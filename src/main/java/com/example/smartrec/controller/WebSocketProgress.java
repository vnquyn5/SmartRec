package com.example.smartrec.controller;

import java.security.Principal;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.JobSnapshotDTO;
import com.example.smartrec.service.JobProgressAccessService;
import com.example.smartrec.service.JobProgressService;

import lombok.RequiredArgsConstructor;

@Controller
@RequiredArgsConstructor
public class WebSocketProgress {
    /** Bảo đảm request chứa đúng meeting/job và người gửi được phép đọc chúng. */
    private final JobProgressAccessService jobProgressAccessService;

    /** Đọc snapshot nhất quán với trạng thái Job đã lưu. */
    private final JobProgressService jobProgressService;

    /** Gửi snapshot đến user destination thay vì broadcast nội dung riêng tư. */
    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Nhận yêu cầu đọc snapshot qua STOMP, kiểm tra quyền rồi phản hồi riêng tới Principal gọi request.
     *
     * <p>Destination đầy đủ là {@code /app/ai-progress}: {@code /app} là application prefix trong
     * WebSocketConfig, còn {@code /ai-progress} là mapping của handler. Client trước hết cần đăng ký
     * {@code /user/queue/ai-progress}, sau đó mới gửi ProgressRequest tới destination này.</p>
     *
     * @param request meetingId/jobId client muốn đọc; cả hai đều được kiểm tra trước khi trả snapshot
     * @param principal danh tính được gắn vào STOMP session sau khi CONNECT xác thực thành công
     */
    @MessageMapping("/ai-progress")
    public void getProgress(ProgressRequest request, Principal principal) {
        // Từ chối payload null/thiếu khóa trước khi truy vấn repository; không thể đọc theo ID không đầy đủ.
        if (request == null || request.meetingId() == null || request.jobId() == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_PROGRESS_REQUEST",
                    "meetingId và jobId là bắt buộc");
        }
        if (principal == null) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Yêu cầu đăng nhập");
        }

        // meetingId do client gửi chỉ là đầu vào chưa tin cậy; service xác minh Job thuộc Meeting và user là owner.
        jobProgressAccessService.assertCanReadJob(request.meetingId(), request.jobId(), principal.getName());

        // Chỉ đọc snapshot sau khi quyền đã được xác nhận, tránh trả state trước bước authorize.
        JobSnapshotDTO snapshot = jobProgressService.getSnapshot(request.jobId());

        // User destination được Spring resolve theo Principal; phản hồi không đi vào topic Job dùng chung.
        messagingTemplate.convertAndSendToUser(principal.getName(), "/queue/ai-progress", snapshot);
    }

    /** Payload tối thiểu client gửi tới /app/ai-progress để yêu cầu snapshot có kiểm tra Meeting/Job cùng lúc. */
    public record ProgressRequest(UUID meetingId, UUID jobId) {}
}
