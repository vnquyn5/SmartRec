package com.example.smartrec.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import com.example.smartrec.entity.Transcript;

public interface TranscriptRepository extends JpaRepository<Transcript, UUID> {

    List<Transcript> findByMeetingIdOrderByStartTimeMsAsc(UUID meetingId);

    List<Transcript> findByProcessingJobIdOrderByStartTimeMsAsc(UUID processingJobId);

    /**
     * Kiểm tra nguồn transcript theo cả meeting và job. Một meeting có thể giữ transcript của nhiều
     * lần xử lý; chỉ kiểm tra meeting có thể đánh dấu nhầm job cũ là nguồn hiện hành.
     */
    boolean existsByProcessingJobIdAndMeetingId(UUID processingJobId, UUID meetingId);

    /**
     * Tìm chuỗi con không phân biệt hoa thường trong transcript của một meeting/job. Derived
     * method để Spring Data tự tạo truy vấn và count query; Pageable giữ sort và phân trang ở DB.
     * Spring Data escape ký tự wildcard của LIKE trong giá trị Containing để '%' và '_' được tìm
     * như ký tự nhập vào, không biến thành mẫu ký tự.
     */
    Page<Transcript> findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
            UUID meetingId,
            UUID processingJobId,
            String textContent,
            Pageable pageable);

    /** Cùng tìm kiếm và phân trang nhưng thêm điều kiện speaker chính xác, tránh tham số UUID null. */
    Page<Transcript> findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(
            UUID meetingId,
            UUID processingJobId,
            UUID speakerId,
            String textContent,
            Pageable pageable);
}
