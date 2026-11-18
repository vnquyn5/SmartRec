-- Repair event_sequence for existing PostgreSQL databases before starting
-- Spring Boot with Hibernate ddl-auto=update. Safe to run more than once.
-- A fresh database without processing_jobs is left untouched; Hibernate will
-- create the table and @ColumnDefault("0") supplies the matching default.
BEGIN;

DO $$
DECLARE
    job_table regclass := to_regclass('processing_jobs');
BEGIN
    IF job_table IS NULL THEN
        RAISE NOTICE 'processing_jobs does not exist; Hibernate will create it with event_sequence';
    ELSE
        EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS event_sequence BIGINT DEFAULT 0', job_table);

        EXECUTE format('UPDATE %s SET event_sequence = 0 WHERE event_sequence IS NULL', job_table);

        EXECUTE format('ALTER TABLE %s ALTER COLUMN event_sequence SET DEFAULT 0, '
                || 'ALTER COLUMN event_sequence SET NOT NULL', job_table);
    END IF;
END
$$;

COMMIT;
