package com.example.smartrec.controller;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.smartrec.model.dto.AiUsageRequest;
import com.example.smartrec.service.AiUsageIngestionService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/internal/ai-usage")
@RequiredArgsConstructor
public class AiUsageController {
    private final AiUsageIngestionService ingestionService;

    @Value("${smartrec.internal-token:}")
    private String configuredInternalToken;

    @PostMapping
    public ResponseEntity<Void> record(
            @RequestHeader(value = "X-Internal-Token", required = false) String token,
            @Valid @RequestBody AiUsageRequest request) {
        if (token == null || configuredInternalToken == null || configuredInternalToken.isBlank()
                || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                        configuredInternalToken.getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        ingestionService.record(request);
        return ResponseEntity.noContent().build();
    }
}
