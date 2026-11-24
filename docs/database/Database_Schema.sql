--
-- PostgreSQL database dump
--

\restrict 67EOG20czskkrM4FHdQ8NhVaL68ZzQnhrSbFWasoQQ8ubeacd4n19jO5IfMcxjb

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: action_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_items (
    id uuid NOT NULL,
    assignee_name character varying(255),
    assignee_user_id uuid,
    due_date timestamp(6) with time zone,
    meeting_id uuid NOT NULL,
    processing_job_id uuid NOT NULL,
    source_transcript_id uuid,
    status character varying(255) NOT NULL,
    task_name text NOT NULL,
    is_verified boolean NOT NULL,
    assignee_speaker_id uuid,
    assignment_provenance character varying(32),
    deadline_raw text,
    source_refs jsonb
);


--
-- Name: ai_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    estimated_cost double precision,
    fallback_used boolean NOT NULL,
    input_tokens bigint,
    job_id uuid NOT NULL,
    model_name character varying(255) NOT NULL,
    model_version character varying(255),
    output_tokens bigint,
    processing_time bigint,
    total_tokens bigint,
    cpu_usage bigint,
    ram_usage bigint,
    vram_usage bigint,
    processing_time_ms bigint,
    error_code character varying(100),
    meeting_id uuid,
    provider character varying(32),
    request_id uuid,
    status character varying(20) NOT NULL,
    task_type character varying(100),
    token_source character varying(64)
);


--
-- Name: context_payloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.context_payloads (
    id uuid NOT NULL,
    meeting_id uuid,
    payload jsonb NOT NULL
);


--
-- Name: folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.folders (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    name character varying(100) NOT NULL,
    name_key character varying(100) NOT NULL,
    parent_id uuid,
    updated_at timestamp(6) with time zone NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: job_dispatch_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_dispatch_outbox (
    id uuid NOT NULL,
    attempt_count integer NOT NULL,
    available_at timestamp(6) with time zone NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    dispatched_at timestamp(6) with time zone,
    job_id uuid NOT NULL,
    last_error character varying(1000)
);


--
-- Name: job_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_stages (
    id uuid NOT NULL,
    completed_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone NOT NULL,
    error_code character varying(255),
    error_message character varying(255),
    job_id uuid NOT NULL,
    retry_count integer NOT NULL,
    stage character varying(255) NOT NULL,
    started_at timestamp(6) with time zone,
    status character varying(255) NOT NULL,
    updated_at timestamp(6) with time zone,
    CONSTRAINT job_stages_stage_check CHECK (((stage)::text = ANY ((ARRAY['FFMPEG'::character varying, 'WEBRTC'::character varying, 'PYANNOTE'::character varying, 'OUTPUT'::character varying])::text[]))),
    CONSTRAINT job_stages_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'RETRYING'::character varying, 'PAUSED'::character varying, 'CANCELLED'::character varying, 'SUCCESS'::character varying, 'FAILED'::character varying, 'SKIPPED'::character varying])::text[])))
);


--
-- Name: media_file; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_file (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    duration_seconds integer,
    file_size_bytes bigint NOT NULL,
    mime_type character varying(100) NOT NULL,
    multipart_upload_id character varying(255),
    object_key character varying(1000) NOT NULL,
    original_name character varying(500) NOT NULL,
    status character varying(255),
    uploaded_by uuid NOT NULL,
    workspace_id uuid NOT NULL,
    checksum_sha256 character varying(64),
    deleted_at timestamp(6) with time zone,
    deleted_by uuid,
    fingerprint_version integer,
    previous_status character varying(50),
    purge_at timestamp(6) with time zone,
    quick_fingerprint character varying(64)
);


--
-- Name: meeting_slides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_slides (
    slide_id uuid NOT NULL,
    job_id uuid NOT NULL,
    keywords jsonb,
    meeting_id uuid NOT NULL,
    object_key character varying(1024) NOT NULL,
    ocr_text text,
    timestamp_ms bigint NOT NULL,
    topic character varying(500)
);


--
-- Name: meeting_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_summaries (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    executive_summary text,
    meeting_id uuid NOT NULL,
    processing_job_id uuid NOT NULL,
    raw_llm_response jsonb
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id uuid NOT NULL,
    active_job_id uuid,
    created_at timestamp(6) with time zone,
    delete_at timestamp(6) with time zone,
    media_file_id uuid NOT NULL,
    processing_mode character varying(50),
    status character varying(255),
    title character varying(500) NOT NULL,
    updated_at timestamp(6) with time zone,
    workspace_id uuid NOT NULL,
    folder_id uuid
);


--
-- Name: ocr_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_results (
    keyframe_id uuid NOT NULL,
    id uuid NOT NULL,
    extracted_text text
);


--
-- Name: ocrresult; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocrresult (
    keyframe_id uuid NOT NULL,
    id uuid NOT NULL,
    extracted_text text
);


--
-- Name: pending_media_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_media_uploads (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    expires_at timestamp(6) with time zone NOT NULL,
    file_name character varying(500) NOT NULL,
    file_size_bytes bigint NOT NULL,
    mime_type character varying(255) NOT NULL,
    object_key character varying(1000) NOT NULL,
    status character varying(20) NOT NULL,
    title character varying(500),
    user_id uuid NOT NULL
);


--
-- Name: processing_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processing_jobs (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    error_code character varying(255),
    error_message character varying(255),
    failed_at timestamp(6) with time zone,
    last_retry_at timestamp(6) with time zone,
    media_file_id uuid NOT NULL,
    retry_count integer NOT NULL,
    status character varying(255) NOT NULL,
    updated_at timestamp(6) with time zone,
    current_stage character varying(255),
    cancel_requested_at timestamp(6) with time zone,
    execution_id uuid,
    last_heartbeat_at timestamp(6) with time zone,
    lease_expires_at timestamp(6) with time zone,
    pause_requested_at timestamp(6) with time zone,
    meeting_id uuid,
    event_sequence bigint NOT NULL,
    CONSTRAINT processing_jobs_current_stage_check CHECK (((current_stage)::text = ANY ((ARRAY['FFMPEG'::character varying, 'WEBRTC'::character varying, 'PYANNOTE'::character varying, 'OUTPUT'::character varying])::text[]))),
    CONSTRAINT processing_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'QUEUED'::character varying, 'RUNNING'::character varying, 'PROCESSING'::character varying, 'RETRYING'::character varying, 'PAUSE_REQUESTED'::character varying, 'PAUSED'::character varying, 'CANCEL_REQUESTED'::character varying, 'CANCELLED'::character varying, 'COMPLETED'::character varying, 'FAILED'::character varying, 'DLQ'::character varying])::text[])))
);


--
-- Name: public_share_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_share_links (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    created_by uuid NOT NULL,
    expires_at timestamp(6) with time zone,
    meeting_id uuid NOT NULL,
    passcode_hash character varying(100),
    revoked_at timestamp(6) with time zone,
    status character varying(20) NOT NULL,
    token_hash character varying(64) NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    CONSTRAINT public_share_links_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'REVOKED'::character varying])::text[])))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    expiry_date timestamp(6) with time zone NOT NULL,
    revoked boolean NOT NULL,
    token character varying(500) NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: share_link_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.share_link_audits (
    id uuid NOT NULL,
    action character varying(30) NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    metadata character varying(500),
    share_link_id uuid NOT NULL,
    CONSTRAINT share_link_audits_action_check CHECK (((action)::text = ANY ((ARRAY['CREATE'::character varying, 'UPDATE_EXPIRY'::character varying, 'UPDATE_PASSCODE'::character varying, 'REVOKE'::character varying])::text[])))
);


--
-- Name: slide_keyframes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slide_keyframes (
    id uuid NOT NULL,
    checksum_sha256 character varying(64),
    content_type character varying(255),
    image_object_key character varying(1000) NOT NULL,
    meeting_id uuid NOT NULL,
    size_bytes bigint,
    timestamp_ms bigint NOT NULL
);


--
-- Name: speaker_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speaker_segments (
    id uuid NOT NULL,
    end_time double precision NOT NULL,
    meeting_id uuid NOT NULL,
    speaker_label character varying(100) NOT NULL,
    start_time double precision NOT NULL
);


--
-- Name: speakers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speakers (
    id uuid NOT NULL,
    ai_label character varying(100) NOT NULL,
    meeting_id uuid NOT NULL,
    real_name character varying(255)
);


--
-- Name: transcripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transcripts (
    id uuid NOT NULL,
    confidence_score numeric(4,3),
    end_time_ms bigint NOT NULL,
    meeting_id uuid NOT NULL,
    processing_job_id uuid NOT NULL,
    speaker_id uuid,
    start_time_ms bigint NOT NULL,
    text_content text NOT NULL,
    attribution_status character varying(40) NOT NULL
);


--
-- Name: upload_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_sessions (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    received_chunks integer NOT NULL,
    status character varying(50) NOT NULL,
    total_chunks integer NOT NULL,
    updated_at timestamp(6) with time zone,
    user_id uuid NOT NULL,
    CONSTRAINT upload_sessions_status_check CHECK (((status)::text = ANY ((ARRAY['INITIATED'::character varying, 'UPLOADING'::character varying, 'COMPLETED'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying])::text[])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    delete_at timestamp(6) with time zone,
    email character varying(255),
    full_name character varying(255) NOT NULL,
    is_active boolean,
    password_hash character varying(255),
    updated_at timestamp(6) with time zone,
    phone character varying(255),
    token_version bigint DEFAULT 0 NOT NULL,
    department character varying(255),
    "position" character varying(255),
    user_code character varying(30),
    auth_provider character varying(20) DEFAULT 'LOCAL'::character varying NOT NULL,
    provider_id character varying(100),
    avatar_url text
);


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    id uuid NOT NULL,
    joined_at timestamp(6) with time zone,
    role character varying(50),
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL
);


--
-- Name: action_items action_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_items
    ADD CONSTRAINT action_items_pkey PRIMARY KEY (id);


--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);


--
-- Name: context_payloads context_payloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_payloads
    ADD CONSTRAINT context_payloads_pkey PRIMARY KEY (id);


--
-- Name: folders folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);


--
-- Name: job_dispatch_outbox job_dispatch_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_dispatch_outbox
    ADD CONSTRAINT job_dispatch_outbox_pkey PRIMARY KEY (id);


--
-- Name: job_stages job_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_stages
    ADD CONSTRAINT job_stages_pkey PRIMARY KEY (id);


--
-- Name: media_file media_file_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_file
    ADD CONSTRAINT media_file_pkey PRIMARY KEY (id);


--
-- Name: meeting_slides meeting_slides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_slides
    ADD CONSTRAINT meeting_slides_pkey PRIMARY KEY (slide_id);


--
-- Name: meeting_summaries meeting_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_summaries
    ADD CONSTRAINT meeting_summaries_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: ocr_results ocr_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_results
    ADD CONSTRAINT ocr_results_pkey PRIMARY KEY (id, keyframe_id);


--
-- Name: ocrresult ocrresult_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocrresult
    ADD CONSTRAINT ocrresult_pkey PRIMARY KEY (id, keyframe_id);


--
-- Name: pending_media_uploads pending_media_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_media_uploads
    ADD CONSTRAINT pending_media_uploads_pkey PRIMARY KEY (id);


--
-- Name: processing_jobs processing_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processing_jobs
    ADD CONSTRAINT processing_jobs_pkey PRIMARY KEY (id);


--
-- Name: public_share_links public_share_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_share_links
    ADD CONSTRAINT public_share_links_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: share_link_audits share_link_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_link_audits
    ADD CONSTRAINT share_link_audits_pkey PRIMARY KEY (id);


--
-- Name: slide_keyframes slide_keyframes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slide_keyframes
    ADD CONSTRAINT slide_keyframes_pkey PRIMARY KEY (id);


--
-- Name: speaker_segments speaker_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaker_segments
    ADD CONSTRAINT speaker_segments_pkey PRIMARY KEY (id);


--
-- Name: speakers speakers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speakers
    ADD CONSTRAINT speakers_pkey PRIMARY KEY (id);


--
-- Name: transcripts transcripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transcripts
    ADD CONSTRAINT transcripts_pkey PRIMARY KEY (id);


--
-- Name: public_share_links uk_3t03fmudrlhe6n4syvmogcwbl; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_share_links
    ADD CONSTRAINT uk_3t03fmudrlhe6n4syvmogcwbl UNIQUE (token_hash);


--
-- Name: pending_media_uploads uk_65o8ppo85e9h96y57gyseylis; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_media_uploads
    ADD CONSTRAINT uk_65o8ppo85e9h96y57gyseylis UNIQUE (object_key);


--
-- Name: users uk_6dotkott2kjsp8vw4d0m25fb7; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uk_6dotkott2kjsp8vw4d0m25fb7 UNIQUE (email);


--
-- Name: users uk_du5v5sr43g5bfnji4vb8hg5s3; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uk_du5v5sr43g5bfnji4vb8hg5s3 UNIQUE (phone);


--
-- Name: meetings uk_fkvvtmlemdvu4nxv4imcw9slw; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT uk_fkvvtmlemdvu4nxv4imcw9slw UNIQUE (media_file_id);


--
-- Name: refresh_tokens uk_ghpmfn23vmxfu3spu3lfg4r2d; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT uk_ghpmfn23vmxfu3spu3lfg4r2d UNIQUE (token);


--
-- Name: upload_sessions upload_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: idx_job_dispatch_outbox_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_dispatch_outbox_pending ON public.job_dispatch_outbox USING btree (available_at, created_at) WHERE (dispatched_at IS NULL);


--
-- Name: idx_pending_media_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_media_expiry ON public.pending_media_uploads USING btree (status, expires_at);


--
-- Name: idx_pending_media_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_media_user_status ON public.pending_media_uploads USING btree (user_id, status);


--
-- Name: idx_transcripts_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transcripts_fts ON public.transcripts USING gin (to_tsvector('simple'::regconfig, text_content));


--
-- Name: idx_users_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_provider ON public.users USING btree (auth_provider, provider_id);


--
-- Name: uq_job_stages_job_id_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_job_stages_job_id_stage ON public.job_stages USING btree (job_id, stage);


--
-- PostgreSQL database dump complete
--

\unrestrict 67EOG20czskkrM4FHdQ8NhVaL68ZzQnhrSbFWasoQQ8ubeacd4n19jO5IfMcxjb

