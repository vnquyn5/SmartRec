package com.example.smartrec.service;

import com.example.smartrec.model.dto.SttRequest;
import com.example.smartrec.model.dto.SttResponse;
import com.example.smartrec.model.dto.SttResultRequest;

public interface SttService {
    // ham tiep nhan va xu ly yeu cau STT
    SttResponse requestStt(SttRequest request);
    // ham tiep nhan kq STT từ AI 
    SttResponse receiveResult(SttResultRequest request);
    
} 
