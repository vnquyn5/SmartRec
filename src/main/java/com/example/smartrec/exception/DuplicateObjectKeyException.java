package com.example.smartrec.exception;

import org.springframework.http.HttpStatus;

public class DuplicateObjectKeyException extends BusinessException {
    public DuplicateObjectKeyException(String bucket, String key) {
        super(
            HttpStatus.CONFLICT,
            "DUPLICATE_OBJECT_KEY",
            String.format("Object already exists with bucket '%s' and key '%s'", bucket, key)
        );
    }
}
