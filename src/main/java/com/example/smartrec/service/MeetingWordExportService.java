package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.service.MeetingService.MeetingDownloadFile;

/** Tạo báo cáo Word từ dữ liệu Meeting có thể đối chiếu với Review-Save đã lưu. */
public interface MeetingWordExportService {
    MeetingDownloadFile exportWord(UUID meetingId);
}
