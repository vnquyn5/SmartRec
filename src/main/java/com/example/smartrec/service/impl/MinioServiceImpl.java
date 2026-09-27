package com.example.smartrec.service.impl;

import com.example.smartrec.service.MinioService;

import io.minio.ComposeObjectArgs;
import io.minio.ComposeSource;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;

import java.util.List;

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

    @Override 
    public void composeObjects(String finalObjectKey,List<String> chunkObjectKeys) throws Exception{
        // lay danh sach chunk va xu ly                        // chuyen moi chunk thanh 1 composeSource de mini ghep chunk   // bucket dang chua chunk  //  ten/key cua chunk hien tai  // tap composeSoure
        List<ComposeSource> sources = chunkObjectKeys.stream().map(objectKey -> ComposeSource.builder().bucket(bucket).object(objectKey).build()).toList();// gom het tat ca composeSouse thanh 1 tolist

        // yeu cau mini ghep chunk // tao thong tin lam viec cua file  // Bucket chứa file sau khi ghép  // Tên/key của file cuối cùng   // Danh sách chunk cần ghép
        minioClient.composeObject(ComposeObjectArgs.builder().bucket(bucket).object(finalObjectKey).build());
    }
}
