BEGIN;

ALTER TABLE action_items
    ADD COLUMN IF NOT EXISTS assignee_speaker_id UUID,
    ADD COLUMN IF NOT EXISTS assignment_provenance VARCHAR(32);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_speakers_meeting_speaker_id'
          AND conrelid = 'public.speakers'::regclass
    ) THEN
        ALTER TABLE speakers
            ADD CONSTRAINT uq_speakers_meeting_speaker_id UNIQUE (meeting_id, id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_action_items_assignee_speaker'
          AND conrelid = 'public.action_items'::regclass
    ) THEN
        ALTER TABLE action_items
            ADD CONSTRAINT fk_action_items_assignee_speaker
            FOREIGN KEY (meeting_id, assignee_speaker_id)
            REFERENCES speakers (meeting_id, id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_action_items_assignee_speaker
    ON action_items (assignee_speaker_id)
    WHERE assignee_speaker_id IS NOT NULL;

COMMIT;
