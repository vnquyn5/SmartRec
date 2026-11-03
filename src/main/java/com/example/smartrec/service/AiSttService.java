package com.example.smartrec.service;

import org.springframework.web.multipart.MultipartFile;

public interface AiSttService {
    // ham chuyen file am thanh thanh van ban STT
    String transcribe(MultipartFile audioFile);
    
} 