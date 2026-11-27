package com.example.smartrec.service;

import com.example.smartrec.model.dto.WordExportRequest;
import com.example.smartrec.model.dto.WordExportResponse;

/** Hợp đồng tạo nội dung DOCX từ template và dữ liệu placeholder đã được tầng gọi chuẩn bị. */
public interface WordExporterService {
    /** Render template và trả nội dung DOCX dạng nhị phân. */
    WordExportResponse exportWord(WordExportRequest request);
}
