BEGIN;

-- Minimal audit storage. Event values stay application-defined; actor, payload,
-- target-object, retention, and delete behavior need a confirmed contract.
CREATE TABLE meeting_audit_logs (
    id UUID PRIMARY KEY,
    meeting_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- A logical prompt may have multiple named versions. No active state, owner,
-- export relation, or production seed is defined by the current contract.
CREATE TABLE prompt_registry (
    id UUID PRIMARY KEY,
    prompt_identifier TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    prompt_content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_prompt_registry_identifier_version
        UNIQUE (prompt_identifier, prompt_version)
);

COMMIT;
