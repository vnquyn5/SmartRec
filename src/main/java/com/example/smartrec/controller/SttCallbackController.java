package com.example.smartrec.controller;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import com.example.smartrec.config.SttProperties;
import com.example.smartrec.model.dto.SttResponse;
import com.example.smartrec.model.dto.SttResultRequest;
import com.example.smartrec.service.SttService;

import jakarta.validation.Valid;
import lombok.AllArgsConstructor;

@RestController
@RequestMapping("/internal/stt")
@AllArgsConstructor 
@Validated
public class SttCallbackController {
    private final SttService sttService;
    private final SttProperties properties;

    @PostMapping("/callback")
    public SttResponse receiveResult(
        //// Đọc giá trị header X-Internal-Token từ HTTP request.
            @RequestHeader(
                    value = "X-Internal-Token",
                    required = false) String token,
            @Valid @RequestBody SttResultRequest request) {

        String expectedToken = properties.getAiEngine().getInternalToken();

        // kiem tra token xem hop le khong 
        if (token == null
                || expectedToken == null
                || !MessageDigest.isEqual(
                        token.getBytes(StandardCharsets.UTF_8),
                        expectedToken.getBytes(StandardCharsets.UTF_8))) {

            throw new ResponseStatusException(
                    HttpStatus.UNAUTHORIZED,
                    "Invalid internal token");
        }

        return sttService.receiveResult(request);
    }
}
