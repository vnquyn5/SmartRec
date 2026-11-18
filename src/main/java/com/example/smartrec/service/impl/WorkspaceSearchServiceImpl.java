package com.example.smartrec.service.impl;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.smartrec.entity.Job;
import com.example.smartrec.entity.Speaker;
import com.example.smartrec.entity.Transcript;
import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.MeetingResponseDTO;
import com.example.smartrec.model.dto.PageResponse;
import com.example.smartrec.model.dto.WorkspaceSearchHitDTO;
import com.example.smartrec.repository.JobRepository;
import com.example.smartrec.repository.SpeakerRepository;
import com.example.smartrec.repository.TranscriptRepository;
import com.example.smartrec.service.MeetingService;
import com.example.smartrec.service.WorkspaceSearchService;

import lombok.RequiredArgsConstructor;

/**
 * Điều phối các bước tìm kiếm transcript có liên quan đến bảo mật. Thứ tự có chủ ý: tải và kiểm
 * tra quyền meeting, chọn job hiện hành, kiểm tra speaker và trạng thái nguồn, rồi mới chạy truy
 * vấn có phân trang ở database. Không tải toàn bộ transcript vào Java để lọc hoặc phân trang.
 */
@Service
@RequiredArgsConstructor
public class WorkspaceSearchServiceImpl implements WorkspaceSearchService {
    /** Dùng mặc định page/size theo quy ước phân trang của API meeting hiện có. */
    private static final int DEFAULT_PAGE = 0;
    private static final int DEFAULT_SIZE = 20;

    /** Giới hạn trang search ở 50 hit để kiểm soát kích thước response. */
    private static final int MAX_SIZE = 50;

    /** Số ký tự ngữ cảnh dự kiến lấy ở mỗi phía trước khi mở rộng tới ranh giới từ. */
    private static final int SNIPPET_CONTEXT_CHARS = 80;

    private final MeetingService meetingService;
    private final JobRepository jobRepository;
    private final SpeakerRepository speakerRepository;
    private final TranscriptRepository transcriptRepository;

    @Override
    @Transactional(readOnly = true)
    public PageResponse<WorkspaceSearchHitDTO> searchMeetingTranscript(
            UUID meetingId,
            String query,
            UUID speakerId,
            Integer page,
            Integer size) {
        // Trước tiên chỉ kiểm tra dữ liệu đầu vào. Chưa đọc meeting hay repository ở bước này;
        // SecurityConfig đã yêu cầu xác thực cho các route /meetings/**.
        String normalizedQuery = normalizeQuery(query);
        int pageNumber = page == null ? DEFAULT_PAGE : page;
        int pageSize = size == null ? DEFAULT_SIZE : size;
        validatePagination(pageNumber, pageSize);

        // Tái sử dụng service hiện có để lấy user hiện tại và kiểm tra quyền workspace/meeting,
        // tránh tự viết cơ chế phân quyền song song. Phải kiểm tra quyền trước khi đọc job, speaker
        // hoặc transcript.
        MeetingResponseDTO meeting = meetingService.getMeeting(meetingId);

        // Workspace dùng active_job_id làm bộ kết quả hiện tại của meeting. Không tự chọn job mới
        // nhất: sau retry hoặc khi còn job cũ, cách chọn khác có thể trả transcript Workspace
        // hiện không hiển thị.
        UUID activeJobId = meeting.getActiveJobId();
        if (activeJobId == null) {
            throw transcriptNotReady();
        }

        // Nếu active_job_id trỏ tới job đã mất hoặc job khác meeting thì coi nguồn chưa sẵn sàng.
        // Kiểm tra chéo này ngăn truy vấn theo job không thuộc meeting trên URL.
        Job activeJob = jobRepository.findById(activeJobId)
                .filter(job -> meetingId.equals(job.getMeetingId()))
                .orElseThrow(WorkspaceSearchServiceImpl::transcriptNotReady);

        // Chỉ kiểm tra speaker trong meeting đã được cấp quyền. UUID hợp lệ nhưng thuộc meeting
        // khác nhận cùng lỗi validation chung, không tiết lộ speaker đó nằm ở đâu.
        if (speakerId != null && !speakerRepository.existsByIdAndMeetingId(speakerId, meetingId)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_SPEAKER_ID",
                    "speakerId does not belong to this meeting");
        }

        // Nguồn đã sẵn sàng nhưng từ khóa không khớp là kết quả rỗng hợp lệ. Kiểm tra riêng sự tồn
        // tại của transcript để không nhầm "chưa sẵn sàng" thành search thành công rỗng.
        if (!transcriptRepository.existsByProcessingJobIdAndMeetingId(activeJob.getId(), meetingId)) {
            throw transcriptNotReady();
        }

        // Cột thời gian đã là millisecond nên giữ nguyên giá trị. Dùng ID nguồn làm tiêu chí phụ
        // khi nhiều hit cùng thời điểm để thứ tự giữa các trang luôn ổn định.
        PageRequest pageable = PageRequest.of(pageNumber, pageSize,
                Sort.by(Sort.Order.asc("startTimeMs"), Sort.Order.asc("id")));

        // Dùng hai derived method để bộ lọc speaker chỉ xuất hiện khi người dùng truyền UUID.
        // Truyền null vào điều kiện equality sẽ tìm speaker_id IS NULL, không có nghĩa là "bỏ lọc".
        Page<Transcript> transcripts = speakerId == null
                ? transcriptRepository.findByMeetingIdAndProcessingJobIdAndTextContentContainingIgnoreCase(
                        meetingId, activeJob.getId(), normalizedQuery, pageable)
                : transcriptRepository.findByMeetingIdAndProcessingJobIdAndSpeakerIdAndTextContentContainingIgnoreCase(
                        meetingId, activeJob.getId(), speakerId, normalizedQuery, pageable);

        // Chỉ tải speaker xuất hiện trong trang hiện tại, không tải toàn bộ roster mỗi lần search.
        // Số ID tra cứu được giới hạn theo size tối đa của trang.
        Map<UUID, Speaker> speakers = findSpeakersForPage(meetingId, transcripts.getContent());
        List<WorkspaceSearchHitDTO> hits = transcripts.getContent().stream()
                .map(transcript -> toHit(transcript, speakers, normalizedQuery))
                .toList();

        // Giữ nguyên cấu trúc PageResponse đang được các API khác sử dụng.
        return new PageResponse<>(hits, transcripts.getNumber(), transcripts.getSize(),
                transcripts.getTotalElements(), transcripts.getTotalPages());
    }

    /**
     * Chỉ lấy metadata speaker của hit trong trang hiện tại. Transcript chưa gán speaker hoặc
     * không còn bản ghi speaker vẫn biểu diễn được bằng name/label null; nếu speaker tồn tại nhưng
     * thuộc meeting khác thì dữ liệu nguồn không nhất quán và không được trả ra response.
     */
    private Map<UUID, Speaker> findSpeakersForPage(UUID meetingId, List<Transcript> transcripts) {
        List<UUID> speakerIds = transcripts.stream()
                .map(Transcript::getSpeakerId)
                .filter(id -> id != null)
                .distinct()
                .toList();
        if (speakerIds.isEmpty()) {
            return Map.of();
        }

        Map<UUID, Speaker> speakers = new HashMap<>();
        for (Speaker speaker : speakerRepository.findAllById(speakerIds)) {
            if (!meetingId.equals(speaker.getMeetingId())) {
                throw new BusinessException(HttpStatus.CONFLICT, "TRANSCRIPT_DATA_INCONSISTENT",
                        "Transcript speaker data is inconsistent");
            }
            speakers.put(speaker.getId(), speaker);
        }
        return speakers;
    }

    /** Ánh xạ đúng các trường FE cần, giữ nguyên start_time_ms và không trả toàn bộ entity. */
    private WorkspaceSearchHitDTO toHit(
            Transcript transcript,
            Map<UUID, Speaker> speakers,
            String query) {
        Speaker speaker = transcript.getSpeakerId() == null ? null : speakers.get(transcript.getSpeakerId());
        return new WorkspaceSearchHitDTO(
                transcript.getId(),
                createSnippet(transcript.getTextContent(), query),
                transcript.getStartTimeMs(),
                transcript.getSpeakerId(),
                speaker == null ? null : speaker.getRealName(),
                speaker == null ? null : speaker.getAiLabel());
    }

    /**
     * Tạo đoạn trích quanh lần xuất hiện đầu tiên. Mở rộng tới khoảng trắng gần nhất để không cắt
     * ngang từ; dấu "..." chỉ phần văn bản đã lược bỏ. Nếu phép so hoa/thường của Java không tìm
     * được vị trí (ánh xạ Unicode đặc biệt), giữ nguyên text nguồn thay vì đoán offset.
     */
    private String createSnippet(String text, String query) {
        if (text == null || text.isEmpty()) {
            return text;
        }
        int matchIndex = indexOfIgnoreCase(text, query);
        if (matchIndex < 0) {
            return text;
        }

        int start = Math.max(0, matchIndex - SNIPPET_CONTEXT_CHARS);
        while (start > 0 && !Character.isWhitespace(text.charAt(start - 1))) {
            start--;
        }
        int end = Math.min(text.length(), matchIndex + query.length() + SNIPPET_CONTEXT_CHARS);
        while (end < text.length() && !Character.isWhitespace(text.charAt(end))) {
            end++;
        }

        return (start > 0 ? "..." : "") + text.substring(start, end) + (end < text.length() ? "..." : "");
    }

    /** Quét text không phân biệt hoa thường chỉ để đặt snippet; lọc hit đã thực hiện ở database. */
    private int indexOfIgnoreCase(String text, String query) {
        int lastPossibleStart = text.length() - query.length();
        for (int i = 0; i <= lastPossibleStart; i++) {
            if (text.regionMatches(true, i, query, 0, query.length())) {
                return i;
            }
        }
        return -1;
    }

    /** Trim đầu/cuối nhưng giữ nguyên dấu tiếng Việt và ký tự đặc biệt như dữ liệu tìm kiếm. */
    private String normalizeQuery(String query) {
        if (query == null || query.trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_SEARCH_QUERY", "q must not be blank");
        }
        return query.trim();
    }

    /** Áp dụng contract của API và chặn page không hợp lệ hoặc quá lớn. */
    private void validatePagination(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_SIZE) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_PAGINATION",
                    "page must be non-negative and size must be between 1 and 50");
        }
    }

    /**
     * Phân biệt nguồn chưa sẵn sàng với search hợp lệ nhưng không có hit. Trả 409 để client chờ
     * active job lưu transcript, thay vì hiểu nhầm nguồn chưa có là danh sách kết quả rỗng.
     */
    private static BusinessException transcriptNotReady() {
        return new BusinessException(HttpStatus.CONFLICT, "TRANSCRIPT_NOT_READY",
                "The active meeting transcript is not ready for search");
    }
}
