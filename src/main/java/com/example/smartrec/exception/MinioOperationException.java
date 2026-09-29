package com.example.smartrec.exception;

import org.springframework.http.HttpStatus;

public class MinioOperationException extends BusinessException {

    public MinioOperationException(String message, Throwable cause) {
        super(HttpStatus.SERVICE_UNAVAILABLE, "MINIO_OPERATION_FAILED", message);
        initCause(cause);
    }

    public MinioOperationException(String code, String message, Throwable cause) {
        super(HttpStatus.SERVICE_UNAVAILABLE, code, message);
        initCause(cause);
    }
}
