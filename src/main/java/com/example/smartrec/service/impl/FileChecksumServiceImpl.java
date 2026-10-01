package com.example.smartrec.service.impl;

import java.io.InputStream;
import java.security.MessageDigest;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.FileChecksumService;
import com.example.smartrec.service.MinioService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class FileChecksumServiceImpl implements FileChecksumService {
    private static final int BUFFER_SIZE = 1024 * 1024;

    private final MinioService minioService;

    @Override
    public String calculateSha256(String objectKey) {
        try (InputStream inputStream = minioService.getObject(objectKey)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[BUFFER_SIZE];
            int bytesRead;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                digest.update(buffer, 0, bytesRead);
            }
            return toHex(digest.digest());
        } catch (Exception e) {
            throw new BusinessException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "CHECKSUM_CALCULATION_FAILED",
                    "Không thể tính checksum SHA-256 cho file");
        }
    }

    private String toHex(byte[] bytes) {
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            hex.append(String.format("%02x", value));
        }
        return hex.toString();
    }
}
