package com.example.smartrec.exception;

import org.springframework.http.HttpStatus;
import java.util.List;

import lombok.Getter;

@Getter
public class BusinessException extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    private final List<String> detail;

    public BusinessException(
            HttpStatus status,
            String code,
            String message) {

        super(message);
        this.status = status;
        this.code = code;
        this.detail = List.of();
    }

    public BusinessException(
            HttpStatus status,
            String code,
            String message,
            List<String> detail) {

        super(message);
        this.status = status;
        this.code = code;
        this.detail = detail == null ? List.of() : detail;
    }

}
