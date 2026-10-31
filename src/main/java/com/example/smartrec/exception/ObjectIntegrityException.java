package com.example.smartrec.exception;

import org.springframework.http.HttpStatus;

public class ObjectIntegrityException extends BusinessException {
    public ObjectIntegrityException(String message) {
        super(HttpStatus.BAD_REQUEST, "OBJECT_INTEGRITY_VIOLATION", message);
    }
}
