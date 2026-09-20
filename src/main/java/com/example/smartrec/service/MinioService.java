package com.example.smartrec.service;

import org.springframework.web.multipart.MultipartFile;

public interface MinioService {
    void upLoad(MultipartFile file , String object_key) throws Exception;

    void delete(String objectKey) throws Exception;
}
