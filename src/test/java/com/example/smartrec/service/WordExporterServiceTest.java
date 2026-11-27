package com.example.smartrec.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.apache.poi.wp.usermodel.HeaderFooterType;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.WordExportRequest;
import com.example.smartrec.model.dto.WordExportResponse;
import com.example.smartrec.service.impl.WordExporterServiceImpl;

class WordExporterServiceTest {
    private final WordExporterService exporter = new WordExporterServiceImpl();

    @Test
    void rendersSplitTokensInStyledRunsTableHeaderAndFooter() throws IOException {
        ByteArrayResource template;
        try (XWPFDocument document = new XWPFDocument()) {
            XWPFParagraph paragraph = document.createParagraph();
            paragraph.setStyle("Title");
            XWPFRun first = addText(paragraph, "Biên bản [M");
            first.setBold(true);
            first.setFontFamily("Arial");
            first.setText("EET");
            addText(paragraph, "ING]");
            addText(paragraph, " · nội dung cố định").setItalic(true);

            var table = document.createTable(2, 1);
            table.setWidth(4200);
            table.getRow(0).getCell(0).setText("Công việc");
            addText(table.getRow(1).getCell(0).getParagraphs().get(0), "[TASK]").setColor("125987");
            addText(document.createHeader(HeaderFooterType.DEFAULT).createParagraph(), "Mã [CODE]");
            addText(document.createFooter(HeaderFooterType.DEFAULT).createParagraph(), "[FOOTER]");
            template = asResource(document);
        }

        WordExportResponse output = exporter.exportWord(new WordExportRequest(template, Map.of(
                "[MEETING]", "Điều phối dự án 🗂", "[TASK]", "Đỗ An – gửi báo cáo & phụ lục",
                "[CODE]", "SR-17", "[FOOTER]", "Lưu hành nội bộ")));

        try (XWPFDocument result = read(output.content())) {
            XWPFParagraph paragraph = result.getParagraphArray(0);
            assertThat(paragraph.getText()).isEqualTo("Biên bản Điều phối dự án 🗂 · nội dung cố định");
            assertThat(paragraph.getStyle()).isEqualTo("Title");
            assertThat(paragraph.getRuns().get(0).isBold()).isTrue();
            assertThat(paragraph.getRuns().get(0).getFontFamily()).isEqualTo("Arial");
            assertThat(paragraph.getRuns().get(2).isItalic()).isTrue();
            assertThat(result.getTables()).hasSize(1);
            var table = result.getTables().get(0);
            assertThat(table.getWidth()).isEqualTo(4200);
            assertThat(table.getRows()).hasSize(2);
            assertThat(table.getRow(0).getCell(0).getText()).isEqualTo("Công việc");
            var renderedTask = table.getRow(1).getCell(0).getParagraphs().get(0).getRuns().get(0);
            assertThat(renderedTask.getText(0)).isEqualTo("Đỗ An – gửi báo cáo & phụ lục");
            assertThat(renderedTask.getColor()).isEqualTo("125987");
            assertThat(result.getHeaderList().get(0).getText()).contains("Mã SR-17");
            assertThat(result.getFooterList().get(0).getText()).contains("Lưu hành nội bộ");
        }
    }

    @Test
    void preservesLineBreaksTabsAndLiteralReplacementText() throws IOException {
        ByteArrayResource template = textTemplate("<A> <B> <A> – cuối");
        String value = "Dòng 1\r\nDòng 2\t<B> $1 \\";
        byte[] output = exportContent(template, Map.of("<A>", value, "<B>", "<Kết thúc>"));

        try (XWPFDocument result = read(output)) {
            assertThat(result.getParagraphArray(0).getText()).isEqualTo(
                    "Dòng 1\nDòng 2\t<B> $1 \\ <Kết thúc> Dòng 1\nDòng 2\t<B> $1 \\ – cuối");
        }
    }

    @Test
    void rendersLargeUnicodeValuesLiterally() throws IOException {
        String value = "Tiếng Việt <&> 🗂 ".repeat(2_000);
        try (XWPFDocument result = read(exportContent(textTemplate("[LONG]"), Map.of("[LONG]", value)))) {
            assertThat(result.getParagraphArray(0).getText()).isEqualTo(value);
        }
    }

    @Test
    void rejectsMissingInvalidAndEmptyTemplates(@TempDir Path temp) {
        Map<String, String> values = Map.of("[VALUE]", "Nội dung");
        assertFailure(() -> exportContent(new FileSystemResource(temp.resolve("missing.docx")), values),
                HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_NOT_FOUND");
        assertFailure(() -> exportContent(new ByteArrayResource(new byte[0]), values),
                HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_INVALID");
        assertFailure(() -> exportContent(new ByteArrayResource("not a docx".getBytes(StandardCharsets.UTF_8)), values),
                HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_INVALID");
        assertFailure(() -> exportContent(new ByteArrayResource(new byte[] { 'P', 'K', 3, 4 }), values),
                HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_INVALID");
    }

    @Test
    void requiresEachTokenAndRejectsInvalidXmlText() throws IOException {
        ByteArrayResource template = textTemplate("[PRESENT]");
        assertFailure(() -> exporter.exportWord(null), HttpStatus.BAD_REQUEST, "VALIDATION_ERROR");
        assertFailure(() -> exporter.exportWord(new WordExportRequest(null, Map.of("[PRESENT]", "value"))),
                HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_NOT_FOUND");
        assertFailure(() -> exportContent(template, Map.of("[PRESENT]", "giá trị", "[MISSING]", "thiếu")),
                HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_PLACEHOLDER_MISSING");
        assertFailure(() -> exportContent(template, Map.of("[PRESENT]", "bad\u0000value")),
                HttpStatus.BAD_REQUEST, "VALIDATION_ERROR");
        assertFailure(() -> exportContent(template, Map.of()), HttpStatus.BAD_REQUEST, "VALIDATION_ERROR");
        assertFailure(() -> exporter.exportWord(new WordExportRequest(template, null)),
                HttpStatus.BAD_REQUEST, "VALIDATION_ERROR");
        Map<String, String> invalidEntries = new HashMap<>();
        invalidEntries.put("   ", "value");
        assertFailure(() -> exportContent(template, invalidEntries), HttpStatus.BAD_REQUEST, "VALIDATION_ERROR");
        invalidEntries.clear();
        invalidEntries.put(null, "value");
        assertFailure(() -> exportContent(template, invalidEntries), HttpStatus.BAD_REQUEST, "VALIDATION_ERROR");
        invalidEntries.clear();
        invalidEntries.put("[PRESENT]", null);
        assertFailure(() -> exportContent(template, invalidEntries), HttpStatus.BAD_REQUEST, "VALIDATION_ERROR");
        try (XWPFDocument result = read(exportContent(template, Map.of("[PRESENT]", "")))) {
            assertThat(result.getParagraphArray(0).getText()).isEmpty();
        }
    }

    @Test
    void prefersLongerOverlappingTokensAndKeepsPlaceholderTextInsideValuesLiteral() throws IOException {
        ByteArrayResource template = textTemplate("{{TASK_OWNER}} | {{TASK}}");
        byte[] output = exportContent(template, Map.of(
                "{{TASK", "giá trị {{TASK_OWNER}}", "{{TASK_OWNER}}", "chịu trách nhiệm"));

        try (XWPFDocument result = read(output)) {
            assertThat(result.getParagraphArray(0).getText())
                    .isEqualTo("chịu trách nhiệm | giá trị {{TASK_OWNER}}}}");
        }
    }

    @Test
    void doesNotMatchATokenAcrossAnExistingLineBreak() throws IOException {
        ByteArrayResource template;
        try (XWPFDocument document = new XWPFDocument()) {
            XWPFRun run = addText(document.createParagraph(), "[VAL");
            run.addBreak();
            run.setText("UE]");
            template = asResource(document);
        }
        assertFailure(() -> exportContent(template, Map.of("[VALUE]", "Nội dung")),
                HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_PLACEHOLDER_MISSING");
    }

    @Test
    void repeatConcurrentAndRetryCallsUseIndependentDocuments() throws Exception {
        ByteArrayResource template = textTemplate("[VALUE]");
        assertFailure(() -> exportContent(template, Map.of("[MISSING]", "Sai")),
                HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_PLACEHOLDER_MISSING");

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(() -> exportContent(template, Map.of("[VALUE]", "Một")));
            var second = pool.submit(() -> exportContent(template, Map.of("[VALUE]", "Hai")));
            try (XWPFDocument firstResult = read(first.get(10, TimeUnit.SECONDS));
                    XWPFDocument secondResult = read(second.get(10, TimeUnit.SECONDS));
                    XWPFDocument repeated = read(exportContent(template, Map.of("[VALUE]", "Một")));
                    XWPFDocument original = read(template.getByteArray())) {
                assertThat(firstResult.getParagraphArray(0).getText()).isEqualTo("Một");
                assertThat(secondResult.getParagraphArray(0).getText()).isEqualTo("Hai");
                assertThat(repeated.getParagraphArray(0).getText()).isEqualTo("Một");
                assertThat(original.getParagraphArray(0).getText()).isEqualTo("[VALUE]");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    private byte[] exportContent(Resource template, Map<String, String> values) {
        return exporter.exportWord(new WordExportRequest(template, values)).content();
    }

    private static void assertFailure(Runnable operation, HttpStatus status, String code) {
        assertThatThrownBy(operation::run).isInstanceOfSatisfying(BusinessException.class, error -> {
            assertThat(error.getStatus()).isEqualTo(status);
            assertThat(error.getCode()).isEqualTo(code);
        });
    }

    private static ByteArrayResource textTemplate(String text) throws IOException {
        try (XWPFDocument document = new XWPFDocument()) {
            addText(document.createParagraph(), text);
            return asResource(document);
        }
    }

    private static XWPFRun addText(XWPFParagraph paragraph, String text) {
        XWPFRun run = paragraph.createRun();
        run.setText(text);
        return run;
    }

    private static ByteArrayResource asResource(XWPFDocument document) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        document.write(output);
        return new ByteArrayResource(output.toByteArray());
    }

    private static XWPFDocument read(byte[] output) throws IOException {
        return new XWPFDocument(new ByteArrayInputStream(output));
    }
}
