BEGIN;

ALTER TABLE processing_jobs
    ADD COLUMN IF NOT EXISTS execution_id UUID,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS pause_requested_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP WITH TIME ZONE;

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
    ON job_dispatch_outbox (available_at, created_at)
    WHERE dispatched_at IS NULL;

COMMIT;
