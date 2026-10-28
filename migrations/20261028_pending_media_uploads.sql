CREATE TABLE IF NOT EXISTS pending_media_uploads (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    object_key VARCHAR(1000) NOT NULL UNIQUE,
    file_name VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    title VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_media_user_status
    ON pending_media_uploads (user_id, status);

CREATE INDEX IF NOT EXISTS idx_pending_media_expiry
    ON pending_media_uploads (status, expires_at);
