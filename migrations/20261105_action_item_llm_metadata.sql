BEGIN;

ALTER TABLE action_items
    ADD COLUMN IF NOT EXISTS deadline_raw TEXT,
    ADD COLUMN IF NOT EXISTS source_refs JSONB;

UPDATE action_items
SET source_refs = jsonb_build_array('TRANSCRIPT:' || source_transcript_id::text)
WHERE source_refs IS NULL
  AND source_transcript_id IS NOT NULL;

WITH candidates AS (
    SELECT
        ai.id AS action_item_id,
        action.value AS raw_action,
        COUNT(*) OVER (PARTITION BY ai.id) AS match_count
    FROM action_items ai
    JOIN meeting_summaries summary
      ON summary.processing_job_id = ai.processing_job_id
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(summary.raw_llm_response -> 'meetingSummary' -> 'action_items') = 'array'
            THEN summary.raw_llm_response -> 'meetingSummary' -> 'action_items'
            ELSE '[]'::jsonb
        END
    ) AS action(value)
    WHERE action.value ->> 'title' = ai.task_name
      AND jsonb_typeof(action.value -> 'source_refs') = 'array'
      AND (
          ai.source_transcript_id IS NULL
          OR (action.value -> 'source_refs') @> jsonb_build_array('TRANSCRIPT:' || ai.source_transcript_id::text)
      )
)
UPDATE action_items ai
SET source_refs = candidates.raw_action -> 'source_refs',
    deadline_raw = COALESCE(ai.deadline_raw, NULLIF(candidates.raw_action ->> 'deadline_raw', ''))
FROM candidates
WHERE candidates.action_item_id = ai.id
  AND candidates.match_count = 1;

UPDATE action_items
SET source_refs = '[]'::jsonb
WHERE source_refs IS NULL;

COMMIT;
