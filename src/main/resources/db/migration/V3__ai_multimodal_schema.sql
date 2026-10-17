
-- V3__ai_multimodal_schema.sql
-- SmartRec: AI multimodal result tables and AI usage

-- 1. Speakers
CREATE TABLE IF NOT EXISTS speakers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL,
    ai_label VARCHAR(100) NOT NULL,
    real_name VARCHAR(255),
    CONSTRAINT fk_speakers_meeting
        FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

-- 2. Transcripts
CREATE TABLE IF NOT EXISTS transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL,
    processing_job_id UUID NOT NULL,
    speaker_id UUID NOT NULL,
    start_time_ms BIGINT NOT NULL,
    end_time_ms BIGINT NOT NULL,
    text_content TEXT NOT NULL,
    confidence_score NUMERIC(4,3),
    CONSTRAINT fk_transcripts_meeting
        FOREIGN KEY (meeting_id) REFERENCES meetings(id),
    CONSTRAINT fk_transcripts_processing_job
        FOREIGN KEY (processing_job_id) REFERENCES processing_jobs(id),
    CONSTRAINT fk_transcripts_speaker
        FOREIGN KEY (speaker_id) REFERENCES speakers(id),
    CONSTRAINT chk_transcripts_time
        CHECK (start_time_ms >= 0 AND end_time_ms >= start_time_ms),
    CONSTRAINT chk_transcripts_confidence
        CHECK (
            confidence_score IS NULL
            OR confidence_score BETWEEN 0 AND 1
        )
);

-- 3. Slide keyframes
CREATE TABLE IF NOT EXISTS slide_keyframes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL,
    timestamp_ms BIGINT NOT NULL,
    image_object_key VARCHAR(1000) NOT NULL,
    CONSTRAINT fk_slide_keyframes_meeting
        FOREIGN KEY (meeting_id) REFERENCES meetings(id),
    CONSTRAINT chk_slide_keyframes_timestamp
        CHECK (timestamp_ms >= 0)
);

-- 4. OCR results
CREATE TABLE IF NOT EXISTS ocr_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyframe_id UUID NOT NULL,
    extracted_text TEXT,
    diagram_json_structure JSONB,
    CONSTRAINT fk_ocr_results_keyframe
        FOREIGN KEY (keyframe_id) REFERENCES slide_keyframes(id)
);

-- 5. Meeting summaries
CREATE TABLE IF NOT EXISTS meeting_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL,
    processing_job_id UUID NOT NULL,
    executive_summary TEXT,
    raw_llm_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_meeting_summaries_meeting
        FOREIGN KEY (meeting_id) REFERENCES meetings(id),
    CONSTRAINT fk_meeting_summaries_processing_job
        FOREIGN KEY (processing_job_id) REFERENCES processing_jobs(id)
);

-- 6. Action items
CREATE TABLE IF NOT EXISTS action_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL,
    processing_job_id UUID NOT NULL,
    task_name TEXT NOT NULL,
    assignee_name VARCHAR(255),
    assignee_user_id UUID,
    due_date TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    source_transcript_id UUID,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_action_items_meeting
        FOREIGN KEY (meeting_id) REFERENCES meetings(id),
    CONSTRAINT fk_action_items_processing_job
        FOREIGN KEY (processing_job_id) REFERENCES processing_jobs(id),
    CONSTRAINT fk_action_items_assignee_user
        FOREIGN KEY (assignee_user_id) REFERENCES users(id),
    CONSTRAINT fk_action_items_source_transcript
        FOREIGN KEY (source_transcript_id) REFERENCES transcripts(id)
);

-- 7. AI usage
CREATE TABLE IF NOT EXISTS ai_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    model_name VARCHAR(255) NOT NULL,
    model_version VARCHAR(100),
    input_tokens BIGINT,
    output_tokens BIGINT,
    total_tokens BIGINT,
    processing_time_ms BIGINT,
    fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
    estimated_cost NUMERIC(12,6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_ai_usage_processing_job
        FOREIGN KEY (job_id) REFERENCES processing_jobs(id)
);

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_speakers_meeting_id
    ON speakers(meeting_id);

CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_start_time
    ON transcripts(meeting_id, start_time_ms);

CREATE INDEX IF NOT EXISTS idx_transcripts_processing_job_id
    ON transcripts(processing_job_id);

CREATE INDEX IF NOT EXISTS idx_transcripts_speaker_id
    ON transcripts(speaker_id);

CREATE INDEX IF NOT EXISTS idx_slide_keyframes_meeting_timestamp
    ON slide_keyframes(meeting_id, timestamp_ms);

CREATE INDEX IF NOT EXISTS idx_ocr_results_keyframe_id
    ON ocr_results(keyframe_id);

CREATE INDEX IF NOT EXISTS idx_meeting_summaries_meeting_id
    ON meeting_summaries(meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_summaries_processing_job_id
    ON meeting_summaries(processing_job_id);

CREATE INDEX IF NOT EXISTS idx_action_items_meeting_id
    ON action_items(meeting_id);

CREATE INDEX IF NOT EXISTS idx_action_items_processing_job_id
    ON action_items(processing_job_id);

CREATE INDEX IF NOT EXISTS idx_ai_usage_job_id
    ON ai_usage(job_id);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at
    ON ai_usage(created_at);
