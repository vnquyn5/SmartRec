CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    name_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_folders_user_name_key UNIQUE (user_id, name_key)
);

CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);

ALTER TABLE meetings
    ADD COLUMN IF NOT EXISTS folder_id UUID NULL REFERENCES folders(id);

CREATE INDEX IF NOT EXISTS idx_meetings_folder_id ON meetings(folder_id);
