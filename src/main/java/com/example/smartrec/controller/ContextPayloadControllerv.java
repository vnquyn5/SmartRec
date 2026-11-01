package com.example.smartrec.controller;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.ContextPayloadReponse;
import com.example.smartrec.service.ContextPayloadService;

import lombok.RequiredArgsConstructor;

@RestController 
@RequestMapping ("/meetings")
@RequiredArgsConstructor 
public class ContextPayloadControllerv {
    private final ContextPayloadService contextPayloadService;
    @PostMapping("/{meetingId}/context")
    public ResponseEntity<ContextPayloadReponse> createContext(
            @PathVariable UUID meetingId) {
        // @PathVariable lấy meetingId từ URL
        // Spring tự chuyển chuỗi UUID trên URL thành kiểu UUID

        ContextPayloadReponse response =
                contextPayloadService.createContext(meetingId);
        // Gọi Service để lấy transcript, slide OCR và tạo Context Payload

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(response);
        // Trả HTTP 201 CREATED cùng dữ liệu Context Payload
    }

    @GetMapping("/{meetingId}/context")
    public ResponseEntity<ContextPayloadReponse> getContext(
            @PathVariable UUID meetingId) {
        // Lấy meetingId từ URL

        ContextPayloadReponse response =
                contextPayloadService.getContext(meetingId);
        // Gọi Service để tìm Context Payload trong PostgreSQL
        // Sau đó chuyển dữ liệu JSON thành DTO để trả về

        return ResponseEntity.ok(response);
        // Trả HTTP 200 OK cùng dữ liệu Context Payload
    }
    
}
