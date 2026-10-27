package com.example.smartrec.service;

import java.io.InputStream;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;

public interface MinioService {
    // Upload file lên MinIO Bucket
    void upLoadToBucket(MultipartFile file, String bucketName, String objectKey) throws Exception;

    // Kiểm tra object trong bucket được chỉ định
    boolean objectExists(String bucketName, String objectKey);

    // Lấy nội dung file từ MinIO
    InputStream getObject(String bucketName,String objectKey) throws Exception;

    void delete(String bucketName, String objectKey) throws Exception;

    void upLoad(MultipartFile file, String object_key) throws Exception;

    String presignPutObject(String objectKey, int expirySeconds) throws Exception;

    String presignGetObject(String objectKey, int expirySeconds) throws Exception;

    long getObjectSize(String objectKey) throws Exception;

    void delete(String objectKey) throws Exception;

    InputStream getObject(String objectKey) throws Exception;

    boolean objectExists(String objectKey);

    void composeObjects(String finalObjectKey, List<String> chunkObjectKeys) throws Exception;

    InputStream downloadObject(String objectKey);
}
