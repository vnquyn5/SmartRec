BEGIN;

-- Chạy sau 20261125_meeting_audit_review_values.sql. Audit cũ giữ nguyên khi chưa có Job.
ALTER TABLE meeting_audit_logs
    ADD COLUMN IF NOT EXISTS job_id UUID;

COMMIT;
