package com.example.smartrec.service.statemachine;

import com.example.smartrec.entity.ObjectRegistry;
import com.example.smartrec.model.dto.request.TransitionStateRequest;

public interface ObjectStateMachine {

    void validateTransition(ObjectRegistry object, TransitionStateRequest request);

    void executeTransition(ObjectRegistry object, TransitionStateRequest request);
}
