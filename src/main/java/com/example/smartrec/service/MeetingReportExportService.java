package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.service.MeetingService.MeetingDownloadFile;

public interface MeetingReportExportService {
    /** Tạo tệp PDF hoặc CSV từ phiên bản đã review của cuộc họp mà người dùng được phép truy cập. */
    MeetingDownloadFile exportReport(UUID meetingId, String format);
}
