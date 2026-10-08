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

-- A callback updates the pre-created row for its job/stage pair. This database
-- guard also prevents duplicate rows if concurrent job setup paths ever race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_stages_job_id_stage
    ON job_stages (job_id, stage);
