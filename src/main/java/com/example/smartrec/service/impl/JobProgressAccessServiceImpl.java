package com.example.smartrec.service.impl;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Meeting;
import com.example.smartrec.entity.User;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.MeetingRepository;
import com.example.smartrec.repository.UserRepository;
import com.example.smartrec.service.JobProgressAccessService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class JobProgressAccessServiceImpl implements JobProgressAccessService {
    /** Tra cứu Job để xác định Meeting sở hữu trạng thái tiến độ. */
    private final JobRepository jobRepository;

    /** Tra cứu owner của Meeting sau khi quan hệ Job/Meeting được xác minh. */
    private final MeetingRepository meetingRepository;

    /** Chuyển Principal (email hoặc phone) về tài khoản nội bộ có ID để so sánh quyền. */
    private final UserRepository userRepository;

    @Override
    @Transactional(readOnly = true)
    public void assertCanReadJob(UUID jobId, String principalName) {
        // Subscribe chỉ truyền jobId; dùng cùng implementation với request STOMP có cả meetingId/jobId.
        assertCanReadJob(null, jobId, principalName);
    }

    @Override
    @Transactional(readOnly = true)
    public void assertCanReadJob(UUID requestedMeetingId, UUID jobId, String principalName) {
        // Thiếu danh tính là lỗi authentication, không coi đó là lỗi quyền của Meeting.
        if (principalName == null || principalName.isBlank()) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Yêu cầu đăng nhập");
        }

        // Principal có thể là email hoặc phone, cùng dạng định danh mà MeetingServiceImpl đang hỗ trợ.
        User user = userRepository.findByEmail(principalName)
                .or(() -> userRepository.findByPhone(principalName))
                .orElseThrow(() -> new BusinessException(
                        HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "Không tìm thấy người dùng đăng nhập"));
        // Luôn xác minh Job trước khi dùng dữ liệu Meeting; ID không tồn tại trả cùng lỗi not-found.
        Job job = jobRepository.findById(jobId)
                .orElseThrow(() -> notFound());

        // Khi caller cung cấp cả hai ID, bắt buộc chúng mô tả đúng quan hệ lưu trong Job.
        // Trả not-found cho cặp sai để không tiết lộ Job thuộc Meeting nào khác.
        if (requestedMeetingId != null && !requestedMeetingId.equals(job.getMeetingId())) {
            throw notFound();
        }

        // Meeting thiếu dù Job còn tham chiếu tới nó cũng được xử lý như Job không còn đọc được.
        Meeting meeting = meetingRepository.findById(job.getMeetingId())
                .orElseThrow(() -> notFound());

        // Đồng bộ với MeetingServiceImpl.getMeetingForUser: hiện chỉ owner được đọc Meeting.
        // Nếu chính sách Meeting đổi (ví dụ thêm thành viên workspace), cần cập nhật điểm kiểm tra chung này.
        if (!user.getId().equals(meeting.getWorkspace_id())) {
            throw new BusinessException(HttpStatus.FORBIDDEN, "MEETING_ACCESS_DENIED",
                    "Bạn không có quyền truy cập cuộc họp này");
        }
    }

    /** Lỗi không phân biệt Job không có thật với cặp Meeting/Job không khớp. */
    private BusinessException notFound() {
        return new BusinessException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND", "Không tìm thấy Job");
    }
}
