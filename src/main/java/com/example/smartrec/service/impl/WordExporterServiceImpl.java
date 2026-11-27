package com.example.smartrec.service.impl;

import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.NoSuchFileException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import javax.xml.XMLConstants;
import javax.xml.namespace.QName;

import org.apache.poi.EmptyFileException;
import org.apache.poi.UnsupportedFileFormatException;
import org.apache.poi.ooxml.POIXMLException;
import org.apache.poi.openxml4j.exceptions.OpenXML4JRuntimeException;
import org.apache.poi.xwpf.usermodel.IBody;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.xmlbeans.XmlCursor;
import org.apache.xmlbeans.impl.xb.xmlschema.SpaceAttribute;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTText;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.dto.WordExportRequest;
import com.example.smartrec.model.dto.WordExportResponse;
import com.example.smartrec.service.WordExporterService;

@Service
public class WordExporterServiceImpl implements WordExporterService {
    /** Namespace WordprocessingML dùng cho các phần tử text, tab và xuống dòng trong DOCX. */
    private static final String WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    /** Tên các phần tử XML cần nhận diện khi đọc từng run. */
    private static final QName TEXT = new QName(WORD_NS, "t");
    private static final QName RUN_PROPERTIES = new QName(WORD_NS, "rPr");
    /** Các ký tự xuống dòng và tab được chuyển thành phần tử Word tương ứng. */
    private static final Pattern BREAK_OR_TAB = Pattern.compile("[\\n\\t]");

    @Override
    public WordExportResponse exportWord(WordExportRequest request) {
        // Xác thực trước khi tạo bản sao bất biến, tránh NPE với request hoặc map null.
        validateValues(request == null ? null : request.values());
        Map<String, String> replacements = Map.copyOf(request.values());

        // Escape key để Regex khớp placeholder nguyên văn; sắp key dài trước để key prefix không che mất key dài.
        Pattern tokens = Pattern.compile(replacements.keySet().stream()
                .sorted(Comparator.comparingInt(String::length).reversed())
                .map(Pattern::quote)
                .collect(Collectors.joining("|")));

        // Ghi nhận key xuất hiện thật trong template để phát hiện placeholder bị thiếu.
        Set<String> matched = new HashSet<>();

        try (XWPFDocument document = openTemplate(request.template())) {
            replaceInBody(document, tokens, replacements, matched);
            document.getHeaderList().forEach(header -> replaceInBody(header, tokens, replacements, matched));
            document.getFooterList().forEach(footer -> replaceInBody(footer, tokens, replacements, matched));

            // Mỗi key phải xuất hiện ít nhất một lần. Một key vẫn có thể được thay ở nhiều vị trí.
            if (matched.size() != replacements.size()) {
                throw new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_PLACEHOLDER_MISSING",
                        "Mẫu Word thiếu trường bắt buộc");
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            document.write(output);
            return new WordExportResponse(output.toByteArray());
        } catch (IOException | POIXMLException | OpenXML4JRuntimeException ex) {
            throw new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR, "WORD_EXPORT_FAILED",
                    "Không thể tạo tệp Word");
        }
    }

    private static XWPFDocument openTemplate(Resource template) {
        if (template == null) {
            throw templateMissing();
        }
        try (InputStream input = template.getInputStream()) {
            return new XWPFDocument(input);
        } catch (FileNotFoundException | NoSuchFileException ex) {
            // Tách file không tồn tại khỏi template tồn tại nhưng DOCX của nó không hợp lệ.
            throw templateMissing();
        } catch (IOException | POIXMLException | OpenXML4JRuntimeException
                | EmptyFileException | UnsupportedFileFormatException ex) {
            throw new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_INVALID",
                    "Không thể đọc mẫu Word");
        }
    }

    private static BusinessException templateMissing() {
        return new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR, "WORD_TEMPLATE_NOT_FOUND",
                "Không tìm thấy mẫu Word");
    }

    private static void validateValues(Map<String, String> values) {
        // Dùng code point để giữ Unicode, đồng thời từ chối ký tự XML 1.0 không thể ghi vào DOCX.
        if (values == null || values.isEmpty() || values.entrySet().stream().anyMatch(entry ->
                entry.getKey() == null || entry.getKey().isBlank() || entry.getValue() == null
                || !entry.getValue().codePoints().allMatch(WordExporterServiceImpl::isXmlCharacter))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                    "Dữ liệu điền mẫu Word không hợp lệ");
        }
    }

    private static boolean isXmlCharacter(int codePoint) {
        // Các dải này theo quy tắc ký tự hợp lệ của XML 1.0, gồm cả ký tự ngoài BMP như emoji.
        return codePoint == '\t' || codePoint == '\n' || codePoint == '\r'
                || (codePoint >= 0x20 && codePoint <= 0xD7FF)
                || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
                || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
    }

    private static void replaceInBody(IBody body, Pattern tokens, Map<String, String> values, Set<String> matched) {
        // Paragraph và bảng là hai dạng nội dung trực tiếp của document, header, footer và table cell.
        for (XWPFParagraph paragraph : body.getParagraphs()) {
            replaceInParagraph(paragraph, tokens, values, matched);
        }
        for (XWPFTable table : body.getTables()) {
            // Bảng lồng nhau được xử lý đệ quy qua các paragraph và bảng con trong từng cell.
            table.getRows().forEach(row -> row.getTableCells().forEach(cell ->
                    replaceInBody(cell, tokens, values, matched)));
        }
    }

    private static void replaceInParagraph(XWPFParagraph paragraph, Pattern tokens,
            Map<String, String> values, Set<String> matched) {
        // Gom text của nhiều run thành một chuỗi để nhận ra placeholder bị Word chia nhỏ.
        // Mỗi part lưu offset ban đầu để có thể sửa lại đúng các CTText sau khi tìm được match.
        List<TextPart> parts = new ArrayList<>();
        StringBuilder text = new StringBuilder();
        for (XWPFRun run : paragraph.getRuns()) {
            try (XmlCursor cursor = run.getCTR().newCursor()) {
                if (!cursor.toFirstChild()) {
                    continue;
                }
                do {
                    if (TEXT.equals(cursor.getName()) && cursor.getObject() instanceof CTText textNode) {
                        String value = textNode.getStringValue();
                        if (!value.isEmpty()) {
                            parts.add(new TextPart(textNode, text.length()));
                            text.append(value);
                        }
                    } else if (!RUN_PROPERTIES.equals(cursor.getName())) {
                        // Break, tab, drawing và field ngắt mạch text, nên không ghép placeholder xuyên qua chúng.
                        replaceText(parts, text, tokens, values, matched);
                        parts.clear();
                        text.setLength(0);
                    }
                } while (cursor.toNextSibling());
            }
        }
        replaceText(parts, text, tokens, values, matched);
    }

    private static void replaceText(List<TextPart> parts, StringBuilder text, Pattern tokens,
            Map<String, String> values, Set<String> matched) {
        // Tìm match trên text gốc một lần, nên nội dung thay thế không bị quét và thay tiếp.
        List<TokenMatch> occurrences = new ArrayList<>();
        Matcher matcher = tokens.matcher(text);
        while (matcher.find()) {
            String key = matcher.group();
            matched.add(key);
            occurrences.add(new TokenMatch(matcher.start(), matcher.end(), values.get(key)));
        }

        // Sửa từ phải sang trái để các offset phía trước vẫn trỏ đúng text gốc trong từng run.
        int partIndex = parts.size() - 1;
        for (int index = occurrences.size() - 1; index >= 0; index--) {
            TokenMatch match = occurrences.get(index);
            while (parts.get(partIndex).start() >= match.end()) {
                partIndex--;
            }
            TextPart last = parts.get(partIndex);
            // Giữ phần text đứng sau placeholder trong run cuối, kể cả khi placeholder trải qua nhiều run.
            String suffix = last.node().getStringValue().substring(match.end() - last.start());
            while (parts.get(partIndex).start() > match.start()) {
                parts.get(partIndex).node().setStringValue("");
                partIndex--;
            }
            TextPart first = parts.get(partIndex);
            String prefix = first.node().getStringValue().substring(0, match.start() - first.start());
            if (first != last) {
                setText(last.node(), suffix);
            }
            writeValue(first.node(), prefix, match.value(), first == last ? suffix : "");
        }
    }

    private static void writeValue(CTText anchor, String prefix, String value, String suffix) {
        // Chuẩn hóa CRLF/CR về LF trước khi tạo phần tử ngắt dòng của Word.
        String normalized = value.replace("\r\n", "\n").replace('\r', '\n');
        Matcher breaks = BREAK_OR_TAB.matcher(normalized);
        if (!breaks.find()) {
            setText(anchor, prefix + normalized + suffix);
            return;
        }

        setText(anchor, prefix + normalized.substring(0, breaks.start()));
        Node textNode = anchor.getDomNode();
        Node parent = textNode.getParentNode();
        Node next = textNode.getNextSibling();
        int start;
        boolean hasNextBreak;
        do {
            // Chèn w:br hoặc w:tab kế tiếp trong cùng run để giữ style của placeholder.
            insertWordElement(parent, next, normalized.charAt(breaks.start()) == '\n' ? "br" : "tab", "");
            start = breaks.end();
            hasNextBreak = breaks.find();
            if (hasNextBreak) {
                insertWordElement(parent, next, "t", normalized.substring(start, breaks.start()));
            }
        } while (hasNextBreak);
        insertWordElement(parent, next, "t", normalized.substring(start) + suffix);
    }

    private static void setText(CTText node, String value) {
        node.setStringValue(value);
        // Giữ khoảng trắng đầu/cuối trong nội dung thay thế theo quy tắc lưu text của Word.
        node.setSpace(SpaceAttribute.Space.PRESERVE);
    }

    private static void insertWordElement(Node parent, Node before, String name, String value) {
        Element element = parent.getOwnerDocument().createElementNS(WORD_NS, "w:" + name);
        if (!value.isEmpty()) {
            // Giữ khoảng trắng giữa các đoạn text được chèn quanh tab hoặc xuống dòng.
            element.setAttributeNS(XMLConstants.XML_NS_URI, "xml:space", "preserve");
            element.appendChild(parent.getOwnerDocument().createTextNode(value));
        }
        parent.insertBefore(element, before);
    }

    private record TextPart(CTText node, int start) {}

    private record TokenMatch(int start, int end, String value) {}
}
