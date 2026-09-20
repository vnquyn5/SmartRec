package com.example.smartrec.service.impl;

import com.example.smartrec.service.MinioService;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;


@Service 
public class MinioServiceImpl implements MinioService {
    private final MinioClient minioClient;

     @Value ("${minio.bucket-name}")
    private String bucket;

    public MinioServiceImpl(MinioClient minioClient){
        this.minioClient=minioClient;
    }
    @Override 
    public void upLoad(MultipartFile file,String objectKey) throws Exception{
        minioClient.putObject(
            PutObjectArgs.builder()
                        .bucket(bucket)
                        .object(objectKey)
                        .stream(file.getInputStream(), file.getSize(), -1)
                        .contentType(file.getContentType())
                        .build()
        );       
    }

    @Override
    public void delete(String objectKey) throws Exception {
        minioClient.removeObject(
                RemoveObjectArgs.builder()
                        .bucket(bucket)
                        .object(objectKey)
                        .build());
    }
}
