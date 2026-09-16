package com.example.smartrec.exception;

import org.springframework.http.HttpStatus;

import lombok.Getter;

@Getter
public class BusinessException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public BusinessException(
            HttpStatus status,
            String code,
            String message) {

        super(message);
        this.status = status;
        this.code = code;
    }

}
