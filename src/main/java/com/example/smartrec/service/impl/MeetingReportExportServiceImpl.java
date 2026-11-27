package com.example.smartrec.service.impl;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Locale;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.MeetingReportExportService;
import com.example.smartrec.service.MeetingService.MeetingDownloadFile;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
@RequiredArgsConstructor
public class MeetingReportExportServiceImpl implements MeetingReportExportService {
    private static final String ERROR_PREFIX = "MEETING_EXPORT";

    private final ReviewedMeetingReportReader reportReader;

    @Override
    public MeetingDownloadFile exportReport(UUID meetingId, String format) {
        String extension = format == null ? "" : format.strip().toLowerCase(Locale.ROOT);
        if (!"pdf".equals(extension) && !"csv".equals(extension)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_EXPORT_FORMAT",
                    "format phải là pdf hoặc csv");
        }

        // Bộ đọc kiểm tra quyền và đối chiếu dữ liệu review. Tệp được tạo sau khi transaction đọc kết thúc.
        var report = reportReader.read(meetingId, ERROR_PREFIX);
        boolean pdf = "pdf".equals(extension);
        byte[] content;
        try {
            content = pdf ? MeetingReportFiles.pdf(report) : MeetingReportFiles.csv(report);
        } catch (IOException | IllegalArgumentException ex) {
            // Chỉ ghi mã cuộc họp, định dạng và loại lỗi để tránh đưa nội dung báo cáo vào log.
            log.error("Meeting report generation failed for meeting {} ({}, {})",
                    meetingId, extension, ex.getClass().getSimpleName());
            var error = new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR, ERROR_PREFIX + "_FAILED",
                    "Không thể tạo file báo cáo cuộc họp");
            error.initCause(ex);
            throw error;
        }

        String contentType = pdf ? MediaType.APPLICATION_PDF_VALUE : "text/csv;charset=UTF-8";
        return new MeetingDownloadFile("meeting-report-" + meetingId + "." + extension,
                contentType, (long) content.length, new ByteArrayInputStream(content));
    }
}
