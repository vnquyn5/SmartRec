package com.example.smartrec.service;

import java.io.InputStream;
import java.util.List;
import java.io.InputStream;

import org.springframework.web.multipart.MultipartFile;

public interface MinioService {
    void upLoad(MultipartFile file, String object_key) throws Exception;

    String presignPutObject(String objectKey, int expirySeconds) throws Exception;

    long getObjectSize(String objectKey) throws Exception;

    void delete(String objectKey) throws Exception;

    InputStream getObject(String objectKey) throws Exception;

    boolean objectExists(String objectKey);

    void composeObjects( String finalObjectKey,List<String> chunkObjectKeys) throws Exception;

    InputStream downloadObject(String objectKey);
}
