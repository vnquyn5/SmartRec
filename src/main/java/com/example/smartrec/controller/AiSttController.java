package com.example.smartrec.controller;

import lombok.AllArgsConstructor;
import lombok.RequiredArgsConstructor;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import com.example.smartrec.service.AiSttService;


@RestController
@RequestMapping("/ai/stt")
@RequiredArgsConstructor 
public class AiSttController {
    private final AiSttService aiSttService;
    @PostMapping(
            value = "/transcribe",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)// chi nhan request co noi dung multipart/form-data 
    public ResponseEntity<Map<String, String>> transcribe( @RequestPart("file") MultipartFile file) {

        try {
            String transcript = aiSttService.transcribe(file);

            return ResponseEntity.ok(Map.of(
                    "status", "success",
                    "text", transcript
            ));

        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, e.getMessage(), e);

        } catch (IllegalStateException e) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY, e.getMessage(), e);
        }
    }
}
