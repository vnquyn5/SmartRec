package com.example.smartrec.model.dto;

import java.util.Map;

import org.springframework.core.io.Resource;

/** Mẫu Word tin cậy và map placeholder do tầng nghiệp vụ chuẩn bị. */
public record WordExportRequest(Resource template, Map<String, String> values) {
}
