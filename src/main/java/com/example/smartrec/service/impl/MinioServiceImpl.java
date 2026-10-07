package com.example.smartrec.service.impl;

import com.example.smartrec.exception.BusinessException;
import com.example.smartrec.service.MinioService;

import io.minio.ComposeObjectArgs;
import io.minio.ComposeSource;
import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;

import java.io.InputStream;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
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

    @Override
    public void composeObjects(String finalObjectKey, List<String> chunkObjectKeys) throws Exception {
        List<ComposeSource> sources = chunkObjectKeys.stream()
                .map(objectKey -> ComposeSource.builder().bucket(bucket).object(objectKey).build())
                .toList();

        minioClient.composeObject(
                ComposeObjectArgs.builder()
                        .bucket(bucket)
                        .object(finalObjectKey)
                        .sources(sources)
                        .build()
        );
    }

    @Override 
    public InputStream downloadObject(String objectKey){
        try {
            // goi mini cline de lay object/file tu mini
            return minioClient.getObject(GetObjectArgs.builder()
                                                      .bucket(bucket)
                                                      .object(objectKey)
                                                      .build()
        );
        } catch (Exception e) {
           throw new BusinessException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "ERR_MINIO_UNAVAILABLE",
                "Không thể đọc file từ MinIO"
        );
        }
    }
}
