package com.example.smartrec.service.impl;

import java.time.Duration;
import java.util.UUID;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.model.UploadSession;
import com.example.smartrec.service.UploadSessionRedisService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class UploadSessionRedisServiceImpl implements UploadSessionRedisService {

    private final RedisTemplate<String, Object> redisTemplate;
    private static final String KEY_PREFIX = "upload:session:";

    private static final String CHUNK_KEY_PREFIX="upload:session:chunks:";
    // Quy định UploadSession tồn tại trong Redis tối đa 2 giờ.
    private static final Duration SESSION_TTL = Duration.ofHours(2);

    @Override
    public void save(UploadSession session) {
        try {
            String key = KEY_PREFIX + session.getUploadSessionId();

            redisTemplate.opsForValue().set(key, session, SESSION_TTL);
        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "REDIS_ERROR",
                    "Không thể lưu upload session vào Redis");
        }

    }

    @Override
    public UploadSession get(UUID uploadSessionId) {
        try {
            // Tạo Redis key từ uploadSessionId
            String key = KEY_PREFIX + uploadSessionId;

            // Tìm session trong Redis
            Object value = redisTemplate.opsForValue().get(key);

            // Không tìm thấy session
            if (value == null) {
                throw new BusinessException(
                        HttpStatus.NOT_FOUND,
                        "UPLOAD_SESSION_NOT_FOUND",
                        "Không tìm thấy upload session");
            }

            // Redis trả về object
            return (UploadSession) value;

        } catch (BusinessException e) {
            // Giữ nguyên BusinessException bên trên
            throw e;

        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "REDIS_ERROR",
                    "Không thể lấy upload session từ Redis");
        }

    }

    @Override
    public void delete(UUID uploadSessionId) {
        try {
            String key = KEY_PREFIX + uploadSessionId;
            String chunkKey = CHUNK_KEY_PREFIX + uploadSessionId;

            redisTemplate.delete(key);
            redisTemplate.delete(chunkKey);

        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "REDIS_ERROR",
                    "Không thể xóa upload session khỏi Redis");
        }
    }
    
    @Override 
    public boolean isChunkUploaded(UUID uploadSessionId, Integer chunkIndex){
        try {
            String key = CHUNK_KEY_PREFIX + uploadSessionId;
            Boolean exits = redisTemplate.opsForSet().isMember(key, chunkIndex);
            return Boolean.TRUE.equals(exits);
        } catch (Exception e) {
            throw new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR,"REDIS_ERROR","Không thể kiểm tra trạng thái của chunk");
        }
    }

    @Override 
    public void markChunkUploaded(UUID uploadSessionId,Integer chunkIndex){
        try {
            String key = CHUNK_KEY_PREFIX + uploadSessionId;
            redisTemplate.opsForSet().add(key, chunkIndex);
            redisTemplate.expire(key, SESSION_TTL);
        } catch (Exception e) {
            throw new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR,"REDIS_ERROR","Không thể cập nhật trạng thái của chunk");
        }
    }
}
