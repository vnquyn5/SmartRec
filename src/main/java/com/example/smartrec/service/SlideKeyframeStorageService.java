package com.example.smartrec.service;

import java.util.List;
import java.util.UUID;

import org.springframework.web.multipart.MultipartFile;

import com.example.smartrec.entity.SlideKeyframe;

public interface SlideKeyframeStorageService {
    // Khai báo hàm upload ảnh Keyframe và trả về thông tin ảnh đã lưu
    SlideKeyframe uploadKeyframe(
            UUID meetingId,
            Long timestampMs,
            MultipartFile file);

    // Khai báo hàm lấy danh sách Keyframe của cuộc họp có ID tương ứng
    List<SlideKeyframe> getKeyframes(UUID meetingId);
} 