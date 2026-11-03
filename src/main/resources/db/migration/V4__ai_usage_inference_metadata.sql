ALTER TABLE ai_usage
    ADD COLUMN IF NOT EXISTS request_id UUID,
    ADD COLUMN IF NOT EXISTS meeting_id UUID,
    ADD COLUMN IF NOT EXISTS provider VARCHAR(32),
    ADD COLUMN IF NOT EXISTS task_type VARCHAR(100),
    ADD COLUMN IF NOT EXISTS token_source VARCHAR(64),
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'success',
    ADD COLUMN IF NOT EXISTS error_code VARCHAR(100);

-- Native usage inserts bypass Hibernate's @GeneratedValue, so preserve the V3 UUID default.
ALTER TABLE ai_usage
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE ai_usage
    ALTER COLUMN status SET DEFAULT 'success';

ALTER TABLE ai_usage
    ADD CONSTRAINT fk_ai_usage_meeting
        FOREIGN KEY (meeting_id) REFERENCES meetings(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_usage_request_id
    ON ai_usage(request_id)
    WHERE request_id IS NOT NULL;
