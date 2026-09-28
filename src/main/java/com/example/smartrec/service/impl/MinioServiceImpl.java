package com.example.smartrec.service.impl;

import com.example.smartrec.service.MinioService;
import io.minio.ComposeObjectArgs;
import io.minio.ComposeSource;
import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.errors.ErrorResponseException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class MinioServiceImpl implements MinioService {
    private static final Logger log = LoggerFactory.getLogger(MinioServiceImpl.class);
    private static final int MAX_COMPOSE_SOURCES_PER_REQUEST = 500;

    private final MinioClient minioClient;

    @Value("${minio.bucket-name}")
    private String bucket;

    public MinioServiceImpl(MinioClient minioClient) {
        this.minioClient = minioClient;
    }

    @Override
    public void upLoad(MultipartFile file, String objectKey) throws Exception {
        minioClient.putObject(
                PutObjectArgs.builder()
                        .bucket(bucket)
                        .object(objectKey)
                        .stream(file.getInputStream(), file.getSize(), -1)
                        .contentType(file.getContentType())
                        .build());
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
    public InputStream getObject(String objectKey) throws Exception {
        return minioClient.getObject(
                GetObjectArgs.builder()
                        .bucket(bucket)
                        .object(objectKey)
                        .build());
    }

    @Override
    public boolean objectExists(String objectKey) {
        try {
            minioClient.statObject(
                    StatObjectArgs.builder()
                            .bucket(bucket)
                            .object(objectKey)
                            .build());
            return true;
        } catch (ErrorResponseException e) {
            if ("NoSuchKey".equals(e.errorResponse().code())
                    || "NoSuchObject".equals(e.errorResponse().code())) {
                return false;
            }
            logMinioError("Failed to stat object", objectKey, e);
            return false;
        } catch (Exception e) {
            log.error("Failed to stat object. bucket={}, object={}", bucket, objectKey, e);
            return false;
        }
    }

    @Override
    public void composeObjects(String finalObjectKey, List<String> chunkObjectKeys) throws Exception {
        if (chunkObjectKeys == null || chunkObjectKeys.isEmpty()) {
            throw new IllegalArgumentException("chunkObjectKeys must not be empty");
        }

        log.info(
                "Composing MinIO object. bucket={}, finalObjectKey={}, sourceCount={}, firstSource={}, lastSource={}",
                bucket,
                finalObjectKey,
                chunkObjectKeys.size(),
                chunkObjectKeys.get(0),
                chunkObjectKeys.get(chunkObjectKeys.size() - 1));

        List<String> composeSources = chunkObjectKeys;
        List<String> intermediateObjects = new ArrayList<>();
        try {
            if (chunkObjectKeys.size() > MAX_COMPOSE_SOURCES_PER_REQUEST) {
                composeSources = composeIntermediateObjects(finalObjectKey, chunkObjectKeys, intermediateObjects);
            }

            compose(finalObjectKey, composeSources);
            if (!objectExists(finalObjectKey)) {
                throw new IllegalStateException("Final object was not found after MinIO compose: " + finalObjectKey);
            }
        } catch (ErrorResponseException e) {
            logMinioError("MinIO compose failed", finalObjectKey, e);
            throw e;
        } catch (Exception e) {
            log.error(
                    "MinIO compose failed. bucket={}, finalObjectKey={}, sourceCount={}",
                    bucket,
                    finalObjectKey,
                    chunkObjectKeys.size(),
                    e);
            throw e;
        } finally {
            for (String intermediateObject : intermediateObjects) {
                try {
                    delete(intermediateObject);
                } catch (Exception e) {
                    log.warn(
                            "Could not delete intermediate compose object. bucket={}, object={}",
                            bucket,
                            intermediateObject,
                            e);
                }
            }
        }
    }

    private List<String> composeIntermediateObjects(
            String finalObjectKey,
            List<String> chunkObjectKeys,
            List<String> intermediateObjects) throws Exception {
        List<String> composedSources = new ArrayList<>();
        int batchNumber = 0;
        for (int start = 0; start < chunkObjectKeys.size(); start += MAX_COMPOSE_SOURCES_PER_REQUEST) {
            int end = Math.min(start + MAX_COMPOSE_SOURCES_PER_REQUEST, chunkObjectKeys.size());
            List<String> batch = chunkObjectKeys.subList(start, end);
            String intermediateObjectKey = finalObjectKey + ".compose_part_" + batchNumber;

            if (batch.size() == 1) {
                composedSources.add(batch.get(0));
                continue;
            }

            log.info(
                    "Composing intermediate MinIO object. bucket={}, object={}, sourceRange={}..{}, sourceCount={}",
                    bucket,
                    intermediateObjectKey,
                    start,
                    end - 1,
                    batch.size());

            compose(intermediateObjectKey, batch);
            if (!objectExists(intermediateObjectKey)) {
                throw new IllegalStateException(
                        "Intermediate object was not found after MinIO compose: " + intermediateObjectKey);
            }
            intermediateObjects.add(intermediateObjectKey);
            composedSources.add(intermediateObjectKey);
            batchNumber++;
        }
        return composedSources;
    }

    private void compose(String targetObjectKey, List<String> sourceObjectKeys) throws Exception {
        List<ComposeSource> sources = sourceObjectKeys.stream()
                .map(objectKey -> ComposeSource.builder()
                        .bucket(bucket)
                        .object(objectKey)
                        .build())
                .toList();

        minioClient.composeObject(
                ComposeObjectArgs.builder()
                        .bucket(bucket)
                        .object(targetObjectKey)
                        .sources(sources)
                        .build());
    }

    private void logMinioError(String message, String objectKey, ErrorResponseException e) {
        log.error(
                "{}. bucket={}, object={}, errorCode={}, httpStatus={}, requestId={}, hostId={}, message={}",
                message,
                bucket,
                objectKey,
                e.errorResponse().code(),
                e.response() != null ? e.response().code() : null,
                e.errorResponse().requestId(),
                e.errorResponse().hostId(),
                e.errorResponse().message(),
                e);
    }
}
