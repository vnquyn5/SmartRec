package com.example.smartrec.enums;

public enum JobStatus {
    PENDING,
    QUEUED,
    RUNNING,
    PROCESSING,
    RETRYING,
    PAUSE_REQUESTED,
    PAUSED,
    CANCEL_REQUESTED,
    CANCELLED,
    COMPLETED,
    FAILED,
    DLQ
}
