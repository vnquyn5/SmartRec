package com.example.smartrec.controller;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import com.example.smartrec.model.dto.SttRequest;
import com.example.smartrec.model.dto.SttResponse;
import com.example.smartrec.service.SttService;
import jakarta.validation.Valid;
import lombok.AllArgsConstructor;

@RestController
@RequestMapping("/meetings/stt")
@Validated
@AllArgsConstructor 
public class SttController {
    private final SttService sttService;

    @PostMapping
    public SttResponse requestStt(
            @Valid @RequestBody SttRequest request) {

        return sttService.requestStt(request);
    }
}
