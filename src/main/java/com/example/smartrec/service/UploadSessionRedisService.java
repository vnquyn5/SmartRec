package com.example.smartrec.service;

import java.util.UUID;

import com.example.smartrec.model.UploadSession;
import com.example.smartrec.model.dto.ChunkUploadRequest;

public interface UploadSessionRedisService {
    void save(UploadSession session);
    UploadSession get(UUID uploadSessionId);
    void delete(UUID uploadSessionId);
    // kiểm tra chunk xem đã được upload hay chưa
    boolean isChunkUploaded(UUID uploadSessionId,Integer chunkIndex);
    // đánh dấu chunk đã upload thành cônng trong redis chưa
    void markChunkUploaded(UUID uploadSessionId,Integer chunkIndex);
}
