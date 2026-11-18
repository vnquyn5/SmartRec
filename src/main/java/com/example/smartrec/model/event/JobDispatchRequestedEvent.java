package com.example.smartrec.model.event;

import java.util.UUID;

/** Durable outbox identity requested for asynchronous dispatch after its transaction commits. */
public record JobDispatchRequestedEvent(UUID outboxId) {}
