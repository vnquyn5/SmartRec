package com.example.smartrec.service.impl;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.core.io.ClassPathResource;

import com.example.smartrec.service.impl.ReviewedMeetingReportReader.ReviewedActionItem;
import com.example.smartrec.service.impl.ReviewedMeetingReportReader.ReviewedMeetingReport;

final class MeetingReportFiles {
    private static final String FONT_PATH = "fonts/NotoSans-Regular.ttf";

    private MeetingReportFiles() {}

    static byte[] csv(ReviewedMeetingReport report) {
        // BOM giúp Excel nhận diện UTF-8. Dòng meeting chứa tóm tắt, mỗi dòng action_item chứa một công việc.
        StringBuilder csv = new StringBuilder("\uFEFFrecord_type,meeting_id,meeting_title,meeting_created_at,"
                + "executive_summary,action_item_title,assignee_name,deadline_raw,due_date,status\r\n");
        String meetingId = report.meetingId().toString();
        csvRow(csv, "meeting", meetingId, report.title(), Objects.toString(report.createdAt(), ""),
                report.executiveSummary(), "", "", "", "", "");
        for (var item : report.actionItems()) {
            csvRow(csv, "action_item", meetingId, "", "", "", item.title(), item.assigneeName(),
                    item.deadlineRaw(), item.dueDate(), item.status());
        }
        return csv.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static void csvRow(StringBuilder csv, String... cells) {
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) {
                csv.append(',');
            }
            String value = Objects.toString(cells[i], "");
            csv.append('"');
            if (needsTextPrefix(value)) {
                csv.append('\'');
            }
            // Bọc ô bằng ngoặc kép và nhân đôi ngoặc kép bên trong để giữ nguyên dấu phẩy và xuống dòng.
            csv.append(value.replace("\"", "\"\"")).append('"');
        }
        csv.append("\r\n");
    }

    // Kiểm tra ký tự đầu có thể kích hoạt công thức bảng tính, kể cả khi đứng sau khoảng trắng.
    private static boolean needsTextPrefix(String value) {
        for (int offset = 0; offset < value.length();) {
            int codePoint = value.codePointAt(offset);
            if (codePoint == '\t' || codePoint == '\r' || codePoint == '\n') {
                return true;
            }
            if (!Character.isWhitespace(codePoint) && !Character.isSpaceChar(codePoint)
                    && !Character.isISOControl(codePoint) && Character.getType(codePoint) != Character.FORMAT) {
                return "=+-@＝＋－＠".indexOf(codePoint) >= 0;
            }
            offset += Character.charCount(codePoint);
        }
        return false;
    }

    static byte[] pdf(ReviewedMeetingReport report) throws IOException {
        try (var document = new PDDocument(); var fontInput = new ClassPathResource(FONT_PATH).getInputStream()) {
            // Nhúng font đi kèm ứng dụng để đọc được tiếng Việt trên các máy khác nhau.
            PDType0Font font = PDType0Font.load(document, fontInput);
            document.getDocumentInformation().setTitle("Báo cáo cuộc họp SmartRec");
            try (var pages = new PdfPages(document, font)) {
                pages.newPage();
                pages.write(report.title().isBlank() ? "Báo cáo cuộc họp" : report.title(), 20, 28);
                pages.write("Mã cuộc họp: " + report.meetingId(), 9, 15);
                if (report.createdAt() != null) {
                    pages.write("Ngày tạo (UTC): " + report.createdAt(), 9, 15);
                }
                pages.heading("Tóm tắt");
                pages.write(report.executiveSummary(), 11, 17);
                if (report.actionItems().isEmpty()) {
                    pages.heading("Công việc");
                    pages.write("Không có công việc.", 11, 17);
                }
                int number = 0;
                for (var item : report.actionItems()) {
                    pages.writeItem(item, ++number);
                }
            }
            var output = new ByteArrayOutputStream();
            document.save(output);
            return output.toByteArray();
        }
    }

    private static final class PdfPages implements AutoCloseable {
        private static final float MARGIN = 48;
        private static final float HEADER_HEIGHT = 30;
        private static final float SECTION_GAP = 12;
        private static final float SECTION_LEADING = 22;
        private static final float TEXT_WIDTH = PDRectangle.A4.getWidth() - 2 * MARGIN;
        private static final float TEXT_HEIGHT = PDRectangle.A4.getHeight() - 2 * MARGIN - HEADER_HEIGHT;

        private final PDDocument document;
        private final PDType0Font font;
        private PDPageContentStream stream;
        private float y;

        PdfPages(PDDocument document, PDType0Font font) {
            this.document = document;
            this.font = font;
        }

        void newPage() throws IOException {
            close();
            PDPage page = new PDPage(PDRectangle.A4);
            document.addPage(page);
            stream = new PDPageContentStream(document, page);
            y = PDRectangle.A4.getHeight() - MARGIN;
            stream.setNonStrokingColor(0.24f, 0.36f, 0.47f);
            line("SmartRec  /  Báo cáo cuộc họp", 9, MARGIN, y);
            String pageNumber = Integer.toString(document.getNumberOfPages());
            line(pageNumber, 9, MARGIN + TEXT_WIDTH - font.getStringWidth(pageNumber) * 9 / 1000, y);
            y -= HEADER_HEIGHT;
            stream.setNonStrokingColor(0.10f, 0.15f, 0.21f);
        }

        void heading(String text) throws IOException {
            ensureSpace(48);
            y -= SECTION_GAP;
            write(text, 14, SECTION_LEADING);
        }

        void writeItem(ReviewedActionItem item, int number) throws IOException {
            List<String> title = wrap(number + ". " + item.title(), 11);
            List<String> details = new ArrayList<>();
            addField(details, "Người phụ trách", item.assigneeName());
            addField(details, "Hạn hoàn thành", item.deadline());
            addField(details, "Trạng thái", item.status());

            // Tính chiều cao sau khi ngắt dòng để giữ cả công việc trên cùng trang nếu còn đủ chỗ.
            float headingHeight = number == 1 ? SECTION_GAP + SECTION_LEADING : 0;
            float itemHeight = 8 + title.size() * 17 + details.size() * 15;
            float required = headingHeight + itemHeight;
            ensureSpace(required <= TEXT_HEIGHT ? required : headingHeight + 40);
            if (number == 1) {
                heading("Công việc");
            }
            y -= 8;
            writeLines(title, 11, 17);
            writeLines(details, 10, 15);
        }

        private void addField(List<String> details, String label, String value) throws IOException {
            if (!value.isBlank()) {
                details.addAll(wrap(label + ": " + value, 10));
            }
        }

        void write(String text, float fontSize, float leading) throws IOException {
            writeLines(wrap(text, fontSize), fontSize, leading);
        }

        private void writeLines(List<String> lines, float fontSize, float leading) throws IOException {
            for (String text : lines) {
                if (!text.isEmpty()) {
                    ensureSpace(leading);
                    line(text, fontSize, MARGIN, y);
                }
                y -= leading;
            }
        }

        private List<String> wrap(String text, float fontSize) throws IOException {
            List<String> lines = new ArrayList<>();
            // Chuẩn hóa chữ có dấu về NFC trước khi kiểm tra ký tự trong font và đo độ rộng.
            String normalized = Normalizer.normalize(text, Normalizer.Form.NFC).replace("\t", "    ");
            for (String paragraph : normalized.split("\\R", -1)) {
                String printable = printable(paragraph);
                if (printable.isEmpty()) {
                    lines.add("");
                    continue;
                }
                for (int start = 0; start < printable.length();) {
                    int end = lineEnd(printable, start, fontSize);
                    lines.add(printable.substring(start, end).stripTrailing());
                    start = end;
                    while (start < printable.length() && printable.charAt(start) == ' ') {
                        start++;
                    }
                }
            }
            return lines;
        }

        private String printable(String text) {
            StringBuilder result = new StringBuilder(text.length());
            text.codePoints().forEach(codePoint -> {
                if (Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint)) {
                    result.append(' ');
                } else if (!Character.isISOControl(codePoint) && Character.getType(codePoint) != Character.FORMAT) {
                    // Dùng ký tự thay thế khi font thiếu ký tự gốc để PDF vẫn tạo được.
                    result.appendCodePoint(font.getCmapLookup().getGlyphId(codePoint) == 0 ? 0xfffd : codePoint);
                }
            });
            return result.toString();
        }

        // Ưu tiên ngắt ở khoảng trắng. Với từ quá dài, ngắt theo từng mã Unicode để tránh cắt đôi ký tự.
        private int lineEnd(String text, int start, float fontSize) throws IOException {
            float width = 0;
            int lastSpace = start;
            int end = start;
            while (end < text.length()) {
                int codePoint = text.codePointAt(end);
                int next = end + Character.charCount(codePoint);
                width += font.getStringWidth(text.substring(end, next)) * fontSize / 1000;
                if (width > TEXT_WIDTH && end > start) {
                    return lastSpace > start ? lastSpace : end;
                }
                end = next;
                if (codePoint == ' ') {
                    lastSpace = end;
                }
            }
            return end;
        }

        private void ensureSpace(float points) throws IOException {
            if (y - points < MARGIN) {
                newPage();
            }
        }

        private void line(String text, float fontSize, float x, float baseline) throws IOException {
            stream.beginText();
            stream.setFont(font, fontSize);
            stream.newLineAtOffset(x, baseline);
            stream.showText(text);
            stream.endText();
        }

        @Override
        public void close() throws IOException {
            if (stream != null) {
                PDPageContentStream current = stream;
                stream = null;
                current.close();
            }
        }
    }
}
