-- =====================================================
-- V2: JOB PROGRESS INDEXES
-- PostgreSQL 18.6
-- Tables: public.processing_jobs
-- =====================================================

-- 1. Tối ưu tìm Job mới nhất theo Media File
-- Phục vụ truy vấn:
-- findFirstByMediaFileIdOrderByCreatedAtDesc()
CREATE INDEX IF NOT EXISTS idx_processing_jobs_media_created
ON public.processing_jobs (s
    media_file_id,
    created_at DESC
);

-- 2. Tối ưu lọc Job theo Status và thời gian cập nhật
-- Phục vụ truy vấn:
-- findByStatusInOrderByUpdatedAtAsc()
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_updated
ON public.processing_jobs (
    status,
    updated_at ASC
);

-- job_stages đã có UNIQUE INDEX (job_id, stage).
-- Index này hỗ trợ truy vấn theo job_id.
-- Không tạo index trùng lặp.