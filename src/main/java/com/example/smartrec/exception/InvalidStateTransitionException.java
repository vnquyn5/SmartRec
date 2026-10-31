package com.example.smartrec.exception;

import java.util.UUID;
import org.springframework.http.HttpStatus;
import com.example.smartrec.enums.ObjectState;

public class InvalidStateTransitionException extends BusinessException {
    public InvalidStateTransitionException(UUID objectId, ObjectState fromState, ObjectState toState) {
        super(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "INVALID_STATE_TRANSITION",
            String.format("Invalid state transition from [%s] to [%s] for object [%s]", fromState, toState, objectId)
        );
    }
}
