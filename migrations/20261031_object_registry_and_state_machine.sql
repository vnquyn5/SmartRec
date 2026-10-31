CREATE TABLE IF NOT EXISTS object_registry (
    id UUID PRIMARY KEY,
    bucket VARCHAR(100) NOT NULL,
    object_key VARCHAR(1000) NOT NULL,
    size_bytes BIGINT,
    checksum VARCHAR(128),
    mime_type VARCHAR(100),
    artifact_type VARCHAR(50) NOT NULL,
    state VARCHAR(30) NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id),
    meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
    job_id UUID REFERENCES processing_jobs(id) ON DELETE SET NULL,
    parent_object_id UUID REFERENCES object_registry(id) ON DELETE RESTRICT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_object_registry_bucket_key UNIQUE (bucket, object_key),
    CONSTRAINT chk_object_registry_state CHECK (
        state IN ('PENDING', 'UPLOADING', 'READY', 'MARKED_FOR_DELETION', 'DELETED')
    ),
    CONSTRAINT chk_object_registry_ready_integrity CHECK (
        state != 'READY' OR (size_bytes IS NOT NULL AND size_bytes >= 0 AND checksum IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_object_registry_owner_state 
    ON object_registry (owner_id, state);

CREATE INDEX IF NOT EXISTS idx_object_registry_meeting_job 
    ON object_registry (meeting_id, job_id);

CREATE INDEX IF NOT EXISTS idx_object_registry_parent 
    ON object_registry (parent_object_id);

CREATE INDEX IF NOT EXISTS idx_object_registry_pending_stale 
    ON object_registry (created_at) WHERE state = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_object_registry_marked_for_deletion 
    ON object_registry (updated_at) WHERE state = 'MARKED_FOR_DELETION';

CREATE TABLE IF NOT EXISTS object_audit_log (
    id UUID PRIMARY KEY,
    object_id UUID NOT NULL REFERENCES object_registry(id) ON DELETE CASCADE,
    from_state VARCHAR(30),
    to_state VARCHAR(30) NOT NULL,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reason VARCHAR(500),
    context_metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_object_audit_log_object_id 
    ON object_audit_log (object_id, created_at DESC);
