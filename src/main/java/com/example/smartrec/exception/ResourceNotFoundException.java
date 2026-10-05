package com.example.smartrec.exception;

import org.springframework.http.HttpStatus;

public class ResourceNotFoundException extends BusinessException{

    public ResourceNotFoundException(
            String code,
            String message) {

        super(
                HttpStatus.NOT_FOUND,
                code,
                message
        );
    }
}
