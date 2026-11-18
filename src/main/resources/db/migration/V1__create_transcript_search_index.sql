-- =====================================================
-- V1: TRANSCRIPT SEARCH INDEX
-- PostgreSQL 18.6
-- Table: public.transcripts
-- =====================================================

-- 1. Full-text Search Index
-- Dùng simple config để tìm kiếm nội dung Transcript,
-- bao gồm văn bản tiếng Việt có dấu.
CREATE INDEX IF NOT EXISTS idx_transcripts_text_search_gin
ON public.transcripts
USING GIN (
    to_tsvector(
        'simple'::regconfig,
        COALESCE(text_content, '')
    )
);

-- 2. Tối ưu lấy Transcript theo Meeting và thời gian
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_start_time
ON public.transcripts (
    meeting_id,
    start_time_ms ASC
);

-- 3. Tối ưu lấy Transcript theo Processing Job và thời gian
CREATE INDEX IF NOT EXISTS idx_transcripts_job_start_time
ON public.transcripts (
    processing_job_id,
    start_time_ms ASC
);