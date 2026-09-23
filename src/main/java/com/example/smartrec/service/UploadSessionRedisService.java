package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.UploadSession;

public interface UploadSessionRedisService {
    void save(UploadSession session);
    UploadSession get(UUID uploadSessionId);
    void delete(UUID uploadSessionId);

    
}
