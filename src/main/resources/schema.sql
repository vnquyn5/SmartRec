-- Keep the database enum check in sync with JobStatus. Hibernate's update mode
-- does not replace an already-created enum check constraint when enum values change.
ALTER TABLE processing_jobs
    DROP CONSTRAINT IF EXISTS processing_jobs_status_check;

ALTER TABLE processing_jobs
    ADD CONSTRAINT processing_jobs_status_check
    CHECK (status IN (
        'PENDING',
        'QUEUED',
        'RUNNING',
        'PROCESSING',
        'RETRYING',
        'PAUSE_REQUESTED',
        'PAUSED',
        'CANCEL_REQUESTED',
        'CANCELLED',
        'COMPLETED',
        'FAILED',
        'DLQ'
    ));

ALTER TABLE job_stages
    DROP CONSTRAINT IF EXISTS job_stages_status_check;

ALTER TABLE job_stages
    ADD CONSTRAINT job_stages_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'RETRYING', 'PAUSED', 'CANCELLED', 'SUCCESS', 'FAILED', 'SKIPPED'));

ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS execution_id UUID;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS pause_requested_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP WITH TIME ZONE;

-- A callback updates the pre-created row for its job/stage pair. This database
-- guard also prevents duplicate rows if concurrent job setup paths ever race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_stages_job_id_stage
    ON job_stages (job_id, stage);

CREATE TABLE IF NOT EXISTS job_dispatch_outbox (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMP WITH TIME ZONE NOT NULL,
    dispatched_at TIMESTAMP WITH TIME ZONE,
    last_error VARCHAR(1000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_dispatch_outbox_pending
    ON job_dispatch_outbox (available_at, created_at) WHERE dispatched_at IS NULL;

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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_object_registry_bucket_key UNIQUE (bucket, object_key)
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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_object_audit_log_object_id 
    ON object_audit_log (object_id, created_at DESC);

