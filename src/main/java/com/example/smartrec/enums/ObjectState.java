package com.example.smartrec.enums;

import java.util.Set;

public enum ObjectState {
    PENDING,
    UPLOADING,
    READY,
    MARKED_FOR_DELETION,
    DELETED;

    public boolean isTerminal() {
        return this == DELETED;
    }

    public Set<ObjectState> allowedNextStates() {
        return switch (this) {
            case PENDING -> Set.of(UPLOADING, READY, MARKED_FOR_DELETION, DELETED);
            case UPLOADING -> Set.of(READY, MARKED_FOR_DELETION, PENDING);
            case READY -> Set.of(MARKED_FOR_DELETION, READY);
            case MARKED_FOR_DELETION -> Set.of(DELETED, READY);
            case DELETED -> Set.of();
        };
    }
}
