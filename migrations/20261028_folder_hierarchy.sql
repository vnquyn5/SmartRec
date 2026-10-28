ALTER TABLE folders
    ADD COLUMN IF NOT EXISTS parent_id UUID NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_folders_id_user' AND conrelid = 'folders'::regclass) THEN
        ALTER TABLE folders ADD CONSTRAINT uq_folders_id_user UNIQUE (id, user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_folders_parent' AND conrelid = 'folders'::regclass) THEN
        ALTER TABLE folders
            ADD CONSTRAINT fk_folders_parent
            FOREIGN KEY (parent_id, user_id) REFERENCES folders(id, user_id);
    END IF;
END $$;

ALTER TABLE folders
    DROP CONSTRAINT IF EXISTS uk_folders_user_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uk_folders_user_parent_name_key
    ON folders (user_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name_key);

CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
