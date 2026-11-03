package com.example.smartrec.controller;

import java.util.List;
import java.util.UUID; // Sửa UID thành UUID

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.example.smartrec.model.dto.MeetingSlideMetadataRequest;
import com.example.smartrec.model.dto.MeetingSlideResponse;
import com.example.smartrec.service.MeetingSlideService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/meetings/{meetingId}/slides")
@RequiredArgsConstructor
public class MeetingSlideController {

    private final MeetingSlideService meetingSlideService;

    /**
     * Lưu metadata của slide.
     * Theo quy ước của luồng xử lý, artifact cần được upload lên MinIO trước.
     */
    @PostMapping("/metadata")
    public ResponseEntity<MeetingSlideResponse> saveMetadata(
            @PathVariable UUID meetingId,
            @Valid @RequestBody
            MeetingSlideMetadataRequest request) {

        // Đảm bảo meetingId trên URL trùng với meetingId trong JSON body.
        if (!meetingId.equals(request.getMeetingId())) {
            return ResponseEntity.badRequest().build();
        }

        // Chuyển việc xử lý nghiệp vụ sang tầng Service.
        MeetingSlideResponse response =
                meetingSlideService.saveMetaData(request);

        // Trả DTO và HTTP status 201 khi xử lý thành công.
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(response);
    }

    /**
     * Lấy danh sách slide của meeting,
     * có thể lọc theo khoảng timestamp tính bằng mili giây.
     */
    @GetMapping
    public ResponseEntity<List<MeetingSlideResponse>> getSlides(
            @PathVariable UUID meetingId,
            @RequestParam(required = false) Long fromMs,
            @RequestParam(required = false) Long toMs) {

        // Biến lưu danh sách slide được trả về từ Service.
        List<MeetingSlideResponse> slides;

        // Không truyền mốc thời gian: lấy toàn bộ slide của meeting.
        if (fromMs == null && toMs == null) {
            slides = meetingSlideService.getSlidesByMeeting(meetingId);

        // Truyền đủ hai mốc: lấy slide trong khoảng thời gian.
        } else if (fromMs != null && toMs != null) {
            slides = meetingSlideService.getSlidesByMeetingAndTime(
                    meetingId, fromMs, toMs);

        // Chỉ truyền một mốc: request không hợp lệ theo thiết kế hiện tại.
        } else {
            return ResponseEntity.badRequest().build();
        }

        // Trả danh sách slide với HTTP status 200 OK.
        return ResponseEntity.ok(slides);
    }
}