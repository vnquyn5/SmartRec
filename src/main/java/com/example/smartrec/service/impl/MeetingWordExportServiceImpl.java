package com.example.smartrec.service.impl;

import java.io.ByteArrayInputStream;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import com.example.smartrec.model.dto.WordExportRequest;
import com.example.smartrec.service.MeetingService.MeetingDownloadFile;
import com.example.smartrec.service.MeetingWordExportService;
import com.example.smartrec.service.WordExporterService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class MeetingWordExportServiceImpl implements MeetingWordExportService {
    private static final String DOCX_MIME_TYPE =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    private final ReviewedMeetingReportReader reportReader;
    private final WordExporterService wordExporterService;

    // Đường dẫn mẫu Word lấy từ cấu hình, mặc định đọc mẫu trong classpath.
    @Value("${smartrec.word-export.template:classpath:templates/meeting-report.docx}")
    private Resource template;

    @Override
    public MeetingDownloadFile exportWord(UUID meetingId) {
        // Dùng bộ đọc review chung với PDF và CSV, giữ tiền tố mã lỗi riêng của Word.
        var report = reportReader.read(meetingId, "MEETING_WORD_EXPORT");
        String tasks = report.actionItems().stream()
                .map(item -> "- " + item.title() + " | Owner: " + item.assigneeName() + " | Deadline: "
                        + item.deadline() + " | Status: " + item.status())
                .collect(Collectors.joining("\n"));
        // Ghép dữ liệu báo cáo vào các vị trí được đánh dấu trong mẫu Word.
        Map<String, String> values = Map.of(
                "{{MEETING_TITLE}}", report.title(),
                "{{MEETING_ID}}", meetingId.toString(),
                "{{MEETING_CREATED_AT}}", Objects.toString(report.createdAt(), ""),
                "{{APPROVED_SUMMARY}}", report.executiveSummary(),
                "{{APPROVED_ACTION_ITEMS}}", tasks);

        byte[] content = wordExporterService.exportWord(new WordExportRequest(template, values)).content();
        return new MeetingDownloadFile("meeting-report-" + meetingId + ".docx",
                DOCX_MIME_TYPE, (long) content.length, new ByteArrayInputStream(content));
    }
}
