package com.example.smartrec.service;

import java.util.List;

import org.springframework.web.multipart.MultipartFile;

public interface MinioService {
    void upLoad(MultipartFile file, String object_key) throws Exception;

    void delete(String objectKey) throws Exception;

    void composeObjects( String finalObjectKey,List<String> chunkObjectKeys) throws Exception;
}
