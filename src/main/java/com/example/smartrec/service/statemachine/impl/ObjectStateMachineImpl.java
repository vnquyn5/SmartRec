package com.example.smartrec.service.statemachine.impl;

import java.time.Instant;

import org.springframework.stereotype.Component;

import com.example.smartrec.entity.ObjectRegistry;
import com.example.smartrec.enums.ObjectState;
import com.example.smartrec.exception.InvalidStateTransitionException;
import com.example.smartrec.exception.ObjectIntegrityException;
import com.example.smartrec.model.dto.request.TransitionStateRequest;
import com.example.smartrec.service.statemachine.ObjectStateMachine;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component
public class ObjectStateMachineImpl implements ObjectStateMachine {

    @Override
    public void validateTransition(ObjectRegistry object, TransitionStateRequest request) {
        ObjectState currentState = object.getState();
        ObjectState targetState = request.getTargetState();

        if (!currentState.allowedNextStates().contains(targetState)) {
            log.warn("Blocked invalid state transition: {} -> {} for objectId: {}", 
                     currentState, targetState, object.getId());
            throw new InvalidStateTransitionException(object.getId(), currentState, targetState);
        }

        if (targetState == ObjectState.READY) {
            Long finalSize = request.getSizeBytes() != null ? request.getSizeBytes() : object.getSizeBytes();
            String finalChecksum = request.getChecksum() != null ? request.getChecksum() : object.getChecksum();

            if (finalSize == null || finalSize < 0) {
                throw new ObjectIntegrityException("Object size must be specified and non-negative before reaching READY state");
            }
            if (finalChecksum == null || finalChecksum.trim().isEmpty()) {
                throw new ObjectIntegrityException("Object checksum must be specified before reaching READY state");
            }
        }
    }

    @Override
    public void executeTransition(ObjectRegistry object, TransitionStateRequest request) {
        ObjectState targetState = request.getTargetState();

        if (request.getSizeBytes() != null) {
            object.setSizeBytes(request.getSizeBytes());
        }
        if (request.getChecksum() != null) {
            object.setChecksum(request.getChecksum());
        }

        object.setState(targetState);

        if (targetState == ObjectState.DELETED) {
            object.setDeletedAt(Instant.now());
        } else if (object.getDeletedAt() != null && targetState == ObjectState.READY) {
            object.setDeletedAt(null);
        }
    }
}
