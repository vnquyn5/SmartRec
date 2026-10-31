package com.example.smartrec.exception;

import java.util.UUID;
import org.springframework.http.HttpStatus;

public class ObjectNotFoundException extends BusinessException {
    public ObjectNotFoundException(UUID objectId) {
        super(
            HttpStatus.NOT_FOUND,
            "OBJECT_NOT_FOUND",
            String.format("Object with ID '%s' was not found", objectId)
        );
    }
}
