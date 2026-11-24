# SmartRec Database Documentation

## Nguồn và phạm vi

- DB xác minh trực tiếp: PostgreSQL 18.6, database `smartrec_db`, schema ứng dụng duy nhất `public`.
- Thu thập ngày 2026-11-20 (Asia/Bangkok) qua `pg_catalog` ở chế độ chỉ đọc; DDL do `pg_dump 18.6 --schema-only --no-owner --no-privileges` tạo. Không đọc hoặc export dữ liệu hàng.
- 24 bảng, 216 cột, 36 index (30 index hỗ trợ PK/UNIQUE constraint và 6 index độc lập), 155 constraint trong `pg_constraint` (24 PK, 6 UNIQUE, 7 CHECK, 118 NOT NULL), 0 FK.
- 0 view/materialized view, 0 trigger ứng dụng, 0 function/procedure ứng dụng, 0 enum/domain/range tùy chỉnh, 0 sequence/identity. Có 2 cột mang DB default (`users.auth_provider`, `users.token_version`).
- Mô tả mục đích/cột do đối chiếu tên cột và source biên soạn; không phải `COMMENT` từ DB, trừ khi nêu rõ. Cấu trúc, kiểu dữ liệu, constraint và index lấy từ DB.

## Nhóm chức năng

| Nhóm | Bảng | Luồng dữ liệu |
|---|---|---|
| Tài khoản/workspace | `users`, `workspace_members`, `refresh_tokens`, `folders` | Đăng nhập → thành viên workspace/thư mục → token. |
| Upload/media/cuộc họp | `pending_media_uploads`, `upload_sessions`, `media_file`, `meetings` | Upload → tệp media → cuộc họp. |
| Xử lý bất đồng bộ | `processing_jobs`, `job_stages`, `job_dispatch_outbox`, `ai_usage` | Tạo job → outbox phân phối → stage/AI usage → trạng thái job. |
| Nội dung cuộc họp | `transcripts`, `speakers`, `speaker_segments`, `meeting_summaries`, `action_items`, `context_payloads` | Pipeline tạo transcript/người nói → tóm tắt/công việc/ngữ cảnh. |
| Slide/OCR | `meeting_slides`, `slide_keyframes`, `ocr_results`, `ocrresult` | Trích slide/keyframe → OCR; vai trò của `ocrresult` chưa xác minh. |
| Chia sẻ | `public_share_links`, `share_link_audits` | Tạo liên kết → truy cập/thu hồi → audit. |

## Quan hệ

PostgreSQL không có FK. Các cột UUID sau là **tham chiếu logic**, suy ra từ Entity và tên cột; `ocr_results.keyframe_id` còn được xác nhận qua `SlideOCRServiceImpl`. Cardinality dự kiến dựa trên tính nullable và UNIQUE, không phải ràng buộc DB. Sơ đồ trực quan ở [Database_ERD.md](Database_ERD.md).

| Bảng nguồn.cột | Đích logic | Cardinality dự kiến | Chứng cứ |
|---|---|---|---|
| `workspace_members.user_id` | `users` PK | `||..o{` | Entity field |
| `folders.user_id` | `users` PK | `||..o{` | Entity field |
| `folders.parent_id` | `folders` PK | `o|..o{` | Entity field |
| `meetings.folder_id` | `folders` PK | `o|..o{` | Entity field |
| `media_file.uploaded_by` | `users` PK | `||..o{` | Entity field |
| `pending_media_uploads.user_id` | `users` PK | `||..o{` | Entity field |
| `upload_sessions.user_id` | `users` PK | `||..o{` | Entity field |
| `refresh_tokens.user_id` | `users` PK | `||..o{` | Entity field |
| `public_share_links.created_by` | `users` PK | `||..o{` | Entity field |
| `share_link_audits.actor_id` | `users` PK | `||..o{` | Entity field |
| `meetings.media_file_id` | `media_file` PK | `||..o|` | DB UNIQUE + Entity field |
| `processing_jobs.media_file_id` | `media_file` PK | `||..o{` | Entity field |
| `processing_jobs.meeting_id` | `meetings` PK | `o|..o{` | Entity field; DB nullable |
| `meetings.active_job_id` | `processing_jobs` PK | `o|..o{` | Entity field |
| `job_stages.job_id` | `processing_jobs` PK | `||..o{` | Entity field |
| `job_dispatch_outbox.job_id` | `processing_jobs` PK | `||..o{` | Entity field |
| `ai_usage.job_id` | `processing_jobs` PK | `||..o{` | Entity field |
| `ai_usage.meeting_id` | `meetings` PK | `o|..o{` | Entity field |
| `context_payloads.meeting_id` | `meetings` PK | `o|..o{` | Entity field |
| `meeting_slides.meeting_id` | `meetings` PK | `||..o{` | Entity field |
| `meeting_slides.job_id` | `processing_jobs` PK | `||..o{` | Entity field |
| `meeting_summaries.meeting_id` | `meetings` PK | `||..o{` | Entity field |
| `meeting_summaries.processing_job_id` | `processing_jobs` PK | `||..o{` | Entity field |
| `action_items.meeting_id` | `meetings` PK | `||..o{` | Entity field |
| `action_items.processing_job_id` | `processing_jobs` PK | `||..o{` | Entity field |
| `action_items.assignee_user_id` | `users` PK | `o|..o{` | Entity field |
| `action_items.assignee_speaker_id` | `speakers` PK | `o|..o{` | Entity field |
| `action_items.source_transcript_id` | `transcripts` PK | `o|..o{` | Entity field |
| `public_share_links.meeting_id` | `meetings` PK | `||..o{` | Entity field |
| `share_link_audits.share_link_id` | `public_share_links` PK | `||..o{` | Entity field |
| `slide_keyframes.meeting_id` | `meetings` PK | `||..o{` | Entity field |
| `ocr_results.keyframe_id` | `slide_keyframes` PK | `||..o{` | SlideOCRServiceImpl |
| `speakers.meeting_id` | `meetings` PK | `||..o{` | Entity field |
| `speaker_segments.meeting_id` | `meetings` PK | `||..o{` | Entity field |
| `transcripts.meeting_id` | `meetings` PK | `||..o{` | Entity field |
| `transcripts.processing_job_id` | `processing_jobs` PK | `||..o{` | Entity field |
| `transcripts.speaker_id` | `speakers` PK | `o|..o{` | Entity field |

`workspace_id` không có bảng đích `workspaces` trong DB hiện tại. Bảng `ocrresult` không có Entity; không gán quan hệ cho bảng này. Không có `@OneToOne`, `@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@JoinColumn` hoặc `@JoinTable` trong 23 Entity; toàn bộ liên hệ ứng dụng dùng UUID scalar.

## Kiểu dữ liệu và giá trị mặc định

UUID được dùng cho khóa chính và tham chiếu logic; JSONB xuất hiện ở `context_payloads.payload`, `action_items.source_refs`, `meeting_slides.keywords`, `meeting_summaries.raw_llm_response`. Các enum Java dùng `EnumType.STRING` và lưu dưới dạng `character varying`, không có PostgreSQL ENUM. Bảy CHECK hiện diện ở `job_stages` (2), `processing_jobs` (2), `public_share_links`, `share_link_audits`, `upload_sessions`; xem từng bảng và audit để biết sai lệch enum. Không có identity/sequence hay default UUID ở DB; UUID được ứng dụng cấp theo mapping/code.

## Chi tiết từng bảng

### `public.action_items`

Công việc được rút ra từ cuộc họp, gồm người phụ trách và nguồn dẫn.

Entity: `ActionItem`; Repository: `ActionItemRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `assignee_name` | `character varying(255)` | Có | — | — | Tên người được giao việc. |
| `assignee_user_id` | `uuid` | Có | — | — | Định danh người dùng được giao việc; DB không có FK. |
| `due_date` | `timestamp(6) with time zone` | Có | — | — | Hạn hoàn thành công việc chuẩn hóa. |
| `meeting_id` | `uuid` | Không | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `processing_job_id` | `uuid` | Không | — | — | Định danh job xử lý liên quan; DB không có FK. |
| `source_transcript_id` | `uuid` | Có | — | — | Định danh transcript nguồn; DB không có FK. |
| `status` | `character varying(255)` | Không | — | — | Trạng thái bản ghi; xem CHECK constraint nếu có. |
| `task_name` | `text` | Không | — | — | Nội dung công việc. |
| `is_verified` | `boolean` | Không | — | — | Cờ công việc đã được xác minh. |
| `assignee_speaker_id` | `uuid` | Có | — | — | Định danh người nói được giao việc; DB không có FK. |
| `assignment_provenance` | `character varying(32)` | Có | — | — | Nguồn suy ra việc gán người phụ trách. |
| `deadline_raw` | `text` | Có | — | — | Cách diễn đạt hạn chót gốc từ nội dung cuộc họp. |
| `source_refs` | `jsonb` | Có | — | — | Danh sách tham chiếu nguồn dạng JSONB. |

**Constraint:**
- `action_items_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 6 cột (xem cột Null ở bảng trên).

**Index:**
- `action_items_pkey`: `CREATE UNIQUE INDEX action_items_pkey ON public.action_items USING btree (id)`

**Tham chiếu logic từ bảng này:** `action_items.meeting_id` → `meetings`; `action_items.processing_job_id` → `processing_jobs`; `action_items.assignee_user_id` → `users`; `action_items.assignee_speaker_id` → `speakers`; `action_items.source_transcript_id` → `transcripts`. Không có FK trong DB.

### `public.ai_usage`

Ghi nhận lượt sử dụng mô hình AI, token, chi phí ước tính và trạng thái.

Entity: `AiUsage`; Repository: `AiUsageRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm tạo bản ghi. |
| `estimated_cost` | `double precision` | Có | — | — | Chi phí AI ước tính. |
| `fallback_used` | `boolean` | Không | — | — | Cờ đã dùng fallback AI. |
| `input_tokens` | `bigint` | Có | — | — | Số token đầu vào. |
| `job_id` | `uuid` | Không | — | — | Định danh job xử lý liên quan; DB không có FK. |
| `model_name` | `character varying(255)` | Không | — | — | Tên mô hình AI. |
| `model_version` | `character varying(255)` | Có | — | — | Phiên bản mô hình AI. |
| `output_tokens` | `bigint` | Có | — | — | Số token đầu ra. |
| `processing_time` | `bigint` | Có | — | — | Cột thời gian xử lý còn trong DB, không được Entity AiUsage mapping. |
| `total_tokens` | `bigint` | Có | — | — | Tổng số token. |
| `cpu_usage` | `bigint` | Có | — | — | Số liệu sử dụng CPU do ứng dụng ghi. |
| `ram_usage` | `bigint` | Có | — | — | Số liệu sử dụng RAM do ứng dụng ghi. |
| `vram_usage` | `bigint` | Có | — | — | Số liệu sử dụng VRAM do ứng dụng ghi. |
| `processing_time_ms` | `bigint` | Có | — | — | Thời gian xử lý AI, đơn vị mili giây. |
| `error_code` | `character varying(100)` | Có | — | — | Mã lỗi xử lý. |
| `meeting_id` | `uuid` | Có | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `provider` | `character varying(32)` | Có | — | — | Nhà cung cấp mô hình AI. |
| `request_id` | `uuid` | Có | — | — | Định danh yêu cầu AI; chưa có unique index trong DB. |
| `status` | `character varying(20)` | Không | — | — | Trạng thái bản ghi; xem CHECK constraint nếu có. |
| `task_type` | `character varying(100)` | Có | — | — | Loại tác vụ AI. |
| `token_source` | `character varying(64)` | Có | — | — | Nguồn cung cấp token AI. |

**Constraint:**
- `ai_usage_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 6 cột (xem cột Null ở bảng trên).

**Index:**
- `ai_usage_pkey`: `CREATE UNIQUE INDEX ai_usage_pkey ON public.ai_usage USING btree (id)`

**Tham chiếu logic từ bảng này:** `ai_usage.job_id` → `processing_jobs`; `ai_usage.meeting_id` → `meetings`. Không có FK trong DB.

### `public.context_payloads`

Payload ngữ cảnh JSON gắn với cuộc họp.

Entity: `ContextPayload`; Repository: `ContextPayloadRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `meeting_id` | `uuid` | Có | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `payload` | `jsonb` | Không | — | — | Payload ngữ cảnh dạng JSONB. |

**Constraint:**
- `context_payloads_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 2 cột (xem cột Null ở bảng trên).

**Index:**
- `context_payloads_pkey`: `CREATE UNIQUE INDEX context_payloads_pkey ON public.context_payloads USING btree (id)`

**Tham chiếu logic từ bảng này:** `context_payloads.meeting_id` → `meetings`. Không có FK trong DB.

### `public.folders`

Cây thư mục cá nhân để tổ chức cuộc họp.

Entity: `Folder`; Repository: `FolderRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm tạo bản ghi. |
| `name` | `character varying(100)` | Không | — | — | Tên thư mục. |
| `name_key` | `character varying(100)` | Không | — | — | Khóa tên chuẩn hóa dùng trong xử lý thư mục. |
| `parent_id` | `uuid` | Có | — | — | Định danh thư mục cha; DB không có FK. |
| `updated_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm cập nhật bản ghi. |
| `user_id` | `uuid` | Không | — | — | Định danh người dùng liên quan; DB không có FK. |

**Constraint:**
- `folders_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 6 cột (xem cột Null ở bảng trên).

**Index:**
- `folders_pkey`: `CREATE UNIQUE INDEX folders_pkey ON public.folders USING btree (id)`

**Tham chiếu logic từ bảng này:** `folders.user_id` → `users`; `folders.parent_id` → `folders`. Không có FK trong DB.

### `public.job_dispatch_outbox`

Bản ghi outbox phục vụ phân phối job xử lý bất đồng bộ.

Entity: `JobDispatchOutbox`; Repository: `JobDispatchOutboxRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `attempt_count` | `integer` | Không | — | — | Số lần thử phân phối outbox. |
| `available_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm outbox sẵn sàng phân phối. |
| `created_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm tạo bản ghi. |
| `dispatched_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm outbox đã phân phối. |
| `job_id` | `uuid` | Không | — | — | Định danh job xử lý liên quan; DB không có FK. |
| `last_error` | `character varying(1000)` | Có | — | — | Lỗi phân phối outbox gần nhất. |

**Constraint:**
- `job_dispatch_outbox_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 5 cột (xem cột Null ở bảng trên).

**Index:**
- `idx_job_dispatch_outbox_pending`: `CREATE INDEX idx_job_dispatch_outbox_pending ON public.job_dispatch_outbox USING btree (available_at, created_at) WHERE (dispatched_at IS NULL)`
- `job_dispatch_outbox_pkey`: `CREATE UNIQUE INDEX job_dispatch_outbox_pkey ON public.job_dispatch_outbox USING btree (id)`

**Tham chiếu logic từ bảng này:** `job_dispatch_outbox.job_id` → `processing_jobs`. Không có FK trong DB.

### `public.job_stages`

Trạng thái và thời điểm thực thi từng stage của job.

Entity: `JobStage`; Repository: `JobStageRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `completed_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm hoàn tất stage. |
| `created_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm tạo bản ghi. |
| `error_code` | `character varying(255)` | Có | — | — | Mã lỗi xử lý. |
| `error_message` | `character varying(255)` | Có | — | — | Thông điệp lỗi xử lý. |
| `job_id` | `uuid` | Không | — | — | Định danh job xử lý liên quan; DB không có FK. |
| `retry_count` | `integer` | Không | — | — | Số lần thử lại xử lý. |
| `stage` | `character varying(255)` | Không | — | — | Stage của pipeline xử lý. |
| `started_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm bắt đầu stage. |
| `status` | `character varying(255)` | Không | — | — | Trạng thái bản ghi; xem CHECK constraint nếu có. |
| `updated_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm cập nhật bản ghi. |

**Constraint:**
- `job_stages_pkey`: `PRIMARY KEY (id)`
- `job_stages_stage_check`: `CHECK (stage::text = ANY (ARRAY['FFMPEG'::character varying, 'WEBRTC'::character varying, 'PYANNOTE'::character varying, 'OUTPUT'::character varying]::text[]))`
- `job_stages_status_check`: `CHECK (status::text = ANY (ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'RETRYING'::character varying, 'PAUSED'::character varying, 'CANCELLED'::character varying, 'SUCCESS'::character varying, 'FAILED'::character varying, 'SKIPPED'::character varying]::text[]))`
- NOT NULL constraint: 6 cột (xem cột Null ở bảng trên).

**Index:**
- `job_stages_pkey`: `CREATE UNIQUE INDEX job_stages_pkey ON public.job_stages USING btree (id)`
- `uq_job_stages_job_id_stage`: `CREATE UNIQUE INDEX uq_job_stages_job_id_stage ON public.job_stages USING btree (job_id, stage)`

**Tham chiếu logic từ bảng này:** `job_stages.job_id` → `processing_jobs`. Không có FK trong DB.

### `public.media_file`

Metadata tệp media, object storage và trạng thái vòng đời tệp.

Entity: `MediaFile`; Repository: `MediaFileRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm tạo bản ghi. |
| `duration_seconds` | `integer` | Có | — | — | Thời lượng media, đơn vị giây. |
| `file_size_bytes` | `bigint` | Không | — | — | Kích thước tệp, đơn vị byte. |
| `mime_type` | `character varying(100)` | Không | — | — | MIME type của tệp. |
| `multipart_upload_id` | `character varying(255)` | Có | — | — | Định danh phiên multipart upload tại object storage. |
| `object_key` | `character varying(1000)` | Không | — | — | Khóa đối tượng trong object storage. |
| `original_name` | `character varying(500)` | Không | — | — | Tên tệp media ban đầu. |
| `status` | `character varying(255)` | Có | — | — | Trạng thái bản ghi; xem CHECK constraint nếu có. |
| `uploaded_by` | `uuid` | Không | — | — | Định danh người dùng upload tệp; DB không có FK. |
| `workspace_id` | `uuid` | Không | — | — | Định danh workspace; không có bảng workspaces trong DB này. |
| `checksum_sha256` | `character varying(64)` | Có | — | — | Checksum SHA-256. |
| `deleted_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm xóa mềm. |
| `deleted_by` | `uuid` | Có | — | — | Định danh người xóa tệp; DB không có FK. |
| `fingerprint_version` | `integer` | Có | — | — | Phiên bản thuật toán fingerprint. |
| `previous_status` | `character varying(50)` | Có | — | — | Trạng thái tệp trước khi thay đổi vòng đời. |
| `purge_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm dự kiến xóa hẳn tệp. |
| `quick_fingerprint` | `character varying(64)` | Có | — | — | Fingerprint nhanh để nhận diện tệp. |

**Constraint:**
- `media_file_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 7 cột (xem cột Null ở bảng trên).

**Index:**
- `media_file_pkey`: `CREATE UNIQUE INDEX media_file_pkey ON public.media_file USING btree (id)`

**Tham chiếu logic từ bảng này:** `media_file.uploaded_by` → `users`. Không có FK trong DB.

### `public.meeting_slides`

Slide được tạo trong quá trình xử lý cuộc họp, kèm OCR/topic/keyword.

Entity: `MeetingSlide`; Repository: `MeetingSlideRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `slide_id` | `uuid` | Không | — | Có | Định danh slide. |
| `job_id` | `uuid` | Không | — | — | Định danh job xử lý liên quan; DB không có FK. |
| `keywords` | `jsonb` | Có | — | — | Danh sách từ khóa dạng JSONB. |
| `meeting_id` | `uuid` | Không | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `object_key` | `character varying(1024)` | Không | — | — | Khóa đối tượng trong object storage. |
| `ocr_text` | `text` | Có | — | — | Văn bản OCR gắn trực tiếp với slide. |
| `timestamp_ms` | `bigint` | Không | — | — | Vị trí thời gian trong media, đơn vị mili giây. |
| `topic` | `character varying(500)` | Có | — | — | Chủ đề slide. |

**Constraint:**
- `meeting_slides_pkey`: `PRIMARY KEY (slide_id)`
- NOT NULL constraint: 5 cột (xem cột Null ở bảng trên).

**Index:**
- `meeting_slides_pkey`: `CREATE UNIQUE INDEX meeting_slides_pkey ON public.meeting_slides USING btree (slide_id)`

**Tham chiếu logic từ bảng này:** `meeting_slides.meeting_id` → `meetings`; `meeting_slides.job_id` → `processing_jobs`. Không có FK trong DB.

### `public.meeting_summaries`

Bản tóm tắt cuộc họp do job xử lý tạo ra.

Entity: `Summary`; Repository: `SummaryRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm tạo bản ghi. |
| `executive_summary` | `text` | Có | — | — | Nội dung tóm tắt điều hành. |
| `meeting_id` | `uuid` | Không | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `processing_job_id` | `uuid` | Không | — | — | Định danh job xử lý liên quan; DB không có FK. |
| `raw_llm_response` | `jsonb` | Có | — | — | Phản hồi LLM gốc dạng JSONB. |

**Constraint:**
- `meeting_summaries_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 3 cột (xem cột Null ở bảng trên).

**Index:**
- `meeting_summaries_pkey`: `CREATE UNIQUE INDEX meeting_summaries_pkey ON public.meeting_summaries USING btree (id)`

**Tham chiếu logic từ bảng này:** `meeting_summaries.meeting_id` → `meetings`; `meeting_summaries.processing_job_id` → `processing_jobs`. Không có FK trong DB.

### `public.meetings`

Cuộc họp, tệp media nguồn và trạng thái xử lý hiện tại.

Entity: `Meeting`; Repository: `MeetingRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `active_job_id` | `uuid` | Có | — | — | Định danh job hiện hoạt của cuộc họp; DB không có FK. |
| `created_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm tạo bản ghi. |
| `delete_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm xóa mềm theo tên cột hiện có. |
| `media_file_id` | `uuid` | Không | — | — | Định danh tệp media liên quan; DB không có FK. |
| `processing_mode` | `character varying(50)` | Có | — | — | Chế độ xử lý cuộc họp. |
| `status` | `character varying(255)` | Có | — | — | Trạng thái bản ghi; xem CHECK constraint nếu có. |
| `title` | `character varying(500)` | Không | — | — | Tiêu đề hiển thị. |
| `updated_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm cập nhật bản ghi. |
| `workspace_id` | `uuid` | Không | — | — | Định danh workspace; không có bảng workspaces trong DB này. |
| `folder_id` | `uuid` | Có | — | — | Định danh thư mục chứa cuộc họp; DB không có FK. |

**Constraint:**
- `meetings_pkey`: `PRIMARY KEY (id)`
- `uk_fkvvtmlemdvu4nxv4imcw9slw`: `UNIQUE (media_file_id)`
- NOT NULL constraint: 4 cột (xem cột Null ở bảng trên).

**Index:**
- `meetings_pkey`: `CREATE UNIQUE INDEX meetings_pkey ON public.meetings USING btree (id)`
- `uk_fkvvtmlemdvu4nxv4imcw9slw`: `CREATE UNIQUE INDEX uk_fkvvtmlemdvu4nxv4imcw9slw ON public.meetings USING btree (media_file_id)`

**Tham chiếu logic từ bảng này:** `meetings.folder_id` → `folders`; `meetings.media_file_id` → `media_file`; `meetings.active_job_id` → `processing_jobs`. Không có FK trong DB.

### `public.ocr_results`

Văn bản OCR theo keyframe; được OCRResultRepository sử dụng.

Entity: `OCRResult`; Repository: `OCRResultRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `keyframe_id` | `uuid` | Không | — | Có | Định danh slide keyframe liên quan; DB không có FK. |
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `extracted_text` | `text` | Có | — | — | Văn bản OCR trích xuất. |

**Constraint:**
- `ocr_results_pkey`: `PRIMARY KEY (id, keyframe_id)`
- NOT NULL constraint: 2 cột (xem cột Null ở bảng trên).

**Index:**
- `ocr_results_pkey`: `CREATE UNIQUE INDEX ocr_results_pkey ON public.ocr_results USING btree (id, keyframe_id)`

**Tham chiếu logic từ bảng này:** `ocr_results.keyframe_id` → `slide_keyframes`. Không có FK trong DB.

### `public.ocrresult`

Bảng có cấu trúc OCR nhưng không có Entity/Repository tương ứng; mục đích chưa xác minh.

Entity/Repository: không tìm thấy trong source hiện tại.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `keyframe_id` | `uuid` | Không | — | Có | Định danh slide keyframe liên quan; DB không có FK. |
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `extracted_text` | `text` | Có | — | — | Văn bản OCR trích xuất. |

**Constraint:**
- `ocrresult_pkey`: `PRIMARY KEY (id, keyframe_id)`
- NOT NULL constraint: 2 cột (xem cột Null ở bảng trên).

**Index:**
- `ocrresult_pkey`: `CREATE UNIQUE INDEX ocrresult_pkey ON public.ocrresult USING btree (id, keyframe_id)`

### `public.pending_media_uploads`

Tệp upload đơn đang chờ hoàn tất, gồm thời hạn và trạng thái.

Entity: `PendingMediaUpload`; Repository: `PendingMediaUploadRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm tạo bản ghi. |
| `expires_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm hết hiệu lực. |
| `file_name` | `character varying(500)` | Không | — | — | Tên tệp upload. |
| `file_size_bytes` | `bigint` | Không | — | — | Kích thước tệp, đơn vị byte. |
| `mime_type` | `character varying(255)` | Không | — | — | MIME type của tệp. |
| `object_key` | `character varying(1000)` | Không | — | — | Khóa đối tượng trong object storage. |
| `status` | `character varying(20)` | Không | — | — | Trạng thái bản ghi; xem CHECK constraint nếu có. |
| `title` | `character varying(500)` | Có | — | — | Tiêu đề hiển thị. |
| `user_id` | `uuid` | Không | — | — | Định danh người dùng liên quan; DB không có FK. |

**Constraint:**
- `pending_media_uploads_pkey`: `PRIMARY KEY (id)`
- `uk_65o8ppo85e9h96y57gyseylis`: `UNIQUE (object_key)`
- NOT NULL constraint: 9 cột (xem cột Null ở bảng trên).

**Index:**
- `idx_pending_media_expiry`: `CREATE INDEX idx_pending_media_expiry ON public.pending_media_uploads USING btree (status, expires_at)`
- `idx_pending_media_user_status`: `CREATE INDEX idx_pending_media_user_status ON public.pending_media_uploads USING btree (user_id, status)`
- `pending_media_uploads_pkey`: `CREATE UNIQUE INDEX pending_media_uploads_pkey ON public.pending_media_uploads USING btree (id)`
- `uk_65o8ppo85e9h96y57gyseylis`: `CREATE UNIQUE INDEX uk_65o8ppo85e9h96y57gyseylis ON public.pending_media_uploads USING btree (object_key)`

**Tham chiếu logic từ bảng này:** `pending_media_uploads.user_id` → `users`. Không có FK trong DB.

### `public.processing_jobs`

Job xử lý media/cuộc họp, trạng thái, lease, retry và tiến độ.

Entity: `Job`; Repository: `JobRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm tạo bản ghi. |
| `error_code` | `character varying(255)` | Có | — | — | Mã lỗi xử lý. |
| `error_message` | `character varying(255)` | Có | — | — | Thông điệp lỗi xử lý. |
| `failed_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm job thất bại. |
| `last_retry_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm thử lại gần nhất. |
| `media_file_id` | `uuid` | Không | — | — | Định danh tệp media liên quan; DB không có FK. |
| `retry_count` | `integer` | Không | — | — | Số lần thử lại xử lý. |
| `status` | `character varying(255)` | Không | — | — | Trạng thái bản ghi; xem CHECK constraint nếu có. |
| `updated_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm cập nhật bản ghi. |
| `current_stage` | `character varying(255)` | Có | — | — | Stage hiện tại của job. |
| `cancel_requested_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm yêu cầu hủy. |
| `execution_id` | `uuid` | Có | — | — | Định danh lượt thực thi job. |
| `last_heartbeat_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm heartbeat gần nhất. |
| `lease_expires_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm lease thực thi hết hạn. |
| `pause_requested_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm yêu cầu tạm dừng. |
| `meeting_id` | `uuid` | Có | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `event_sequence` | `bigint` | Không | — | — | Số thứ tự sự kiện tiến độ job. |

**Constraint:**
- `processing_jobs_current_stage_check`: `CHECK (current_stage::text = ANY (ARRAY['FFMPEG'::character varying, 'WEBRTC'::character varying, 'PYANNOTE'::character varying, 'OUTPUT'::character varying]::text[]))`
- `processing_jobs_pkey`: `PRIMARY KEY (id)`
- `processing_jobs_status_check`: `CHECK (status::text = ANY (ARRAY['PENDING'::character varying, 'QUEUED'::character varying, 'RUNNING'::character varying, 'PROCESSING'::character varying, 'RETRYING'::character varying, 'PAUSE_REQUESTED'::character varying, 'PAUSED'::character varying, 'CANCEL_REQUESTED'::character varying, 'CANCELLED'::character varying, 'COMPLETED'::character varying, 'FAILED'::character varying, 'DLQ'::character varying]::text[]))`
- NOT NULL constraint: 6 cột (xem cột Null ở bảng trên).

**Index:**
- `processing_jobs_pkey`: `CREATE UNIQUE INDEX processing_jobs_pkey ON public.processing_jobs USING btree (id)`

**Tham chiếu logic từ bảng này:** `processing_jobs.media_file_id` → `media_file`; `processing_jobs.meeting_id` → `meetings`. Không có FK trong DB.

### `public.public_share_links`

Liên kết chia sẻ công khai cho cuộc họp, lưu hash token/passcode.

Entity: `PublicShareLink`; Repository: `PublicShareLinkRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm tạo bản ghi. |
| `created_by` | `uuid` | Không | — | — | Định danh người tạo bản ghi; DB không có FK. |
| `expires_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm hết hiệu lực. |
| `meeting_id` | `uuid` | Không | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `passcode_hash` | `character varying(100)` | Có | — | — | Hash passcode của liên kết chia sẻ. |
| `revoked_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm thu hồi liên kết. |
| `status` | `character varying(20)` | Không | — | — | Trạng thái bản ghi; xem CHECK constraint nếu có. |
| `token_hash` | `character varying(64)` | Không | — | — | Hash của token chia sẻ. |
| `updated_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm cập nhật bản ghi. |

**Constraint:**
- `public_share_links_pkey`: `PRIMARY KEY (id)`
- `public_share_links_status_check`: `CHECK (status::text = ANY (ARRAY['ACTIVE'::character varying, 'REVOKED'::character varying]::text[]))`
- `uk_3t03fmudrlhe6n4syvmogcwbl`: `UNIQUE (token_hash)`
- NOT NULL constraint: 7 cột (xem cột Null ở bảng trên).

**Index:**
- `public_share_links_pkey`: `CREATE UNIQUE INDEX public_share_links_pkey ON public.public_share_links USING btree (id)`
- `uk_3t03fmudrlhe6n4syvmogcwbl`: `CREATE UNIQUE INDEX uk_3t03fmudrlhe6n4syvmogcwbl ON public.public_share_links USING btree (token_hash)`

**Tham chiếu logic từ bảng này:** `public_share_links.created_by` → `users`; `public_share_links.meeting_id` → `meetings`. Không có FK trong DB.

### `public.refresh_tokens`

Refresh token của tài khoản và trạng thái thu hồi.

Entity: `RefreshToken`; Repository: `RefreshTokenRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm tạo bản ghi. |
| `expiry_date` | `timestamp(6) with time zone` | Không | — | — | Thời điểm hết hạn token. |
| `revoked` | `boolean` | Không | — | — | Cờ refresh token đã bị thu hồi. |
| `token` | `character varying(500)` | Không | — | — | Giá trị refresh token; chỉ export cấu trúc, không export dữ liệu. |
| `user_id` | `uuid` | Không | — | — | Định danh người dùng liên quan; DB không có FK. |

**Constraint:**
- `refresh_tokens_pkey`: `PRIMARY KEY (id)`
- `uk_ghpmfn23vmxfu3spu3lfg4r2d`: `UNIQUE (token)`
- NOT NULL constraint: 6 cột (xem cột Null ở bảng trên).

**Index:**
- `refresh_tokens_pkey`: `CREATE UNIQUE INDEX refresh_tokens_pkey ON public.refresh_tokens USING btree (id)`
- `uk_ghpmfn23vmxfu3spu3lfg4r2d`: `CREATE UNIQUE INDEX uk_ghpmfn23vmxfu3spu3lfg4r2d ON public.refresh_tokens USING btree (token)`

**Tham chiếu logic từ bảng này:** `refresh_tokens.user_id` → `users`. Không có FK trong DB.

### `public.share_link_audits`

Sự kiện audit cho thao tác với liên kết chia sẻ.

Entity: `ShareLinkAudit`; Repository: `ShareLinkAuditRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `action` | `character varying(30)` | Không | — | — | Loại hành động audit. |
| `actor_id` | `uuid` | Không | — | — | Định danh người thực hiện hành động audit; DB không có FK. |
| `created_at` | `timestamp(6) with time zone` | Không | — | — | Thời điểm tạo bản ghi. |
| `metadata` | `character varying(500)` | Có | — | — | Metadata mô tả sự kiện audit. |
| `share_link_id` | `uuid` | Không | — | — | Định danh liên kết chia sẻ được audit; DB không có FK. |

**Constraint:**
- `share_link_audits_action_check`: `CHECK (action::text = ANY (ARRAY['CREATE'::character varying, 'UPDATE_EXPIRY'::character varying, 'UPDATE_PASSCODE'::character varying, 'REVOKE'::character varying]::text[]))`
- `share_link_audits_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 5 cột (xem cột Null ở bảng trên).

**Index:**
- `share_link_audits_pkey`: `CREATE UNIQUE INDEX share_link_audits_pkey ON public.share_link_audits USING btree (id)`

**Tham chiếu logic từ bảng này:** `share_link_audits.actor_id` → `users`; `share_link_audits.share_link_id` → `public_share_links`. Không có FK trong DB.

### `public.slide_keyframes`

Ảnh keyframe được trích từ cuộc họp và lưu trong object storage.

Entity: `SlideKeyframe`; Repository: `SlideKeyframeRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `checksum_sha256` | `character varying(64)` | Có | — | — | Checksum SHA-256. |
| `content_type` | `character varying(255)` | Có | — | — | MIME/content type của ảnh. |
| `image_object_key` | `character varying(1000)` | Không | — | — | Khóa ảnh keyframe trong object storage. |
| `meeting_id` | `uuid` | Không | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `size_bytes` | `bigint` | Có | — | — | Kích thước ảnh, đơn vị byte. |
| `timestamp_ms` | `bigint` | Không | — | — | Vị trí thời gian trong media, đơn vị mili giây. |

**Constraint:**
- `slide_keyframes_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 4 cột (xem cột Null ở bảng trên).

**Index:**
- `slide_keyframes_pkey`: `CREATE UNIQUE INDEX slide_keyframes_pkey ON public.slide_keyframes USING btree (id)`

**Tham chiếu logic từ bảng này:** `slide_keyframes.meeting_id` → `meetings`. Không có FK trong DB.

### `public.speaker_segments`

Khoảng thời gian của nhãn người nói trong cuộc họp.

Entity: `SpeakerSegment`; Repository: `SpeakerSegmentRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `end_time` | `double precision` | Không | — | — | Thời điểm kết thúc đoạn người nói theo giá trị lưu trong DB. |
| `meeting_id` | `uuid` | Không | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `speaker_label` | `character varying(100)` | Không | — | — | Nhãn người nói trong đoạn thời gian. |
| `start_time` | `double precision` | Không | — | — | Thời điểm bắt đầu đoạn người nói theo giá trị lưu trong DB. |

**Constraint:**
- `speaker_segments_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 5 cột (xem cột Null ở bảng trên).

**Index:**
- `speaker_segments_pkey`: `CREATE UNIQUE INDEX speaker_segments_pkey ON public.speaker_segments USING btree (id)`

**Tham chiếu logic từ bảng này:** `speaker_segments.meeting_id` → `meetings`. Không có FK trong DB.

### `public.speakers`

Danh tính/nhãn người nói gắn với cuộc họp.

Entity: `Speaker`; Repository: `SpeakerRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `ai_label` | `character varying(100)` | Không | — | — | Nhãn người nói do AI tạo. |
| `meeting_id` | `uuid` | Không | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `real_name` | `character varying(255)` | Có | — | — | Tên thực của người nói. |

**Constraint:**
- `speakers_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 3 cột (xem cột Null ở bảng trên).

**Index:**
- `speakers_pkey`: `CREATE UNIQUE INDEX speakers_pkey ON public.speakers USING btree (id)`

**Tham chiếu logic từ bảng này:** `speakers.meeting_id` → `meetings`. Không có FK trong DB.

### `public.transcripts`

Đoạn transcript có thời điểm, người nói và độ tin cậy.

Entity: `Transcript`; Repository: `TranscriptRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `confidence_score` | `numeric(4,3)` | Có | — | — | Độ tin cậy của transcript. |
| `end_time_ms` | `bigint` | Không | — | — | Thời điểm kết thúc transcript, đơn vị mili giây. |
| `meeting_id` | `uuid` | Không | — | — | Định danh cuộc họp liên quan; DB không có FK. |
| `processing_job_id` | `uuid` | Không | — | — | Định danh job xử lý liên quan; DB không có FK. |
| `speaker_id` | `uuid` | Có | — | — | Định danh người nói liên quan; DB không có FK. |
| `start_time_ms` | `bigint` | Không | — | — | Thời điểm bắt đầu transcript, đơn vị mili giây. |
| `text_content` | `text` | Không | — | — | Nội dung transcript. |
| `attribution_status` | `character varying(40)` | Không | — | — | Trạng thái gán người nói cho transcript. |

**Constraint:**
- `transcripts_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 7 cột (xem cột Null ở bảng trên).

**Index:**
- `idx_transcripts_fts`: `CREATE INDEX idx_transcripts_fts ON public.transcripts USING gin (to_tsvector('simple'::regconfig, text_content))`
- `transcripts_pkey`: `CREATE UNIQUE INDEX transcripts_pkey ON public.transcripts USING btree (id)`

**Tham chiếu logic từ bảng này:** `transcripts.meeting_id` → `meetings`; `transcripts.processing_job_id` → `processing_jobs`; `transcripts.speaker_id` → `speakers`. Không có FK trong DB.

### `public.upload_sessions`

Phiên upload theo chunk và tiến độ ghép tệp.

Entity: `UploadSession`; Repository: `UploadSessionRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm tạo bản ghi. |
| `received_chunks` | `integer` | Không | — | — | Số chunk đã nhận. |
| `status` | `character varying(50)` | Không | — | — | Trạng thái bản ghi; xem CHECK constraint nếu có. |
| `total_chunks` | `integer` | Không | — | — | Tổng số chunk cần upload. |
| `updated_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm cập nhật bản ghi. |
| `user_id` | `uuid` | Không | — | — | Định danh người dùng liên quan; DB không có FK. |

**Constraint:**
- `upload_sessions_pkey`: `PRIMARY KEY (id)`
- `upload_sessions_status_check`: `CHECK (status::text = ANY (ARRAY['INITIATED'::character varying, 'UPLOADING'::character varying, 'COMPLETED'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying]::text[]))`
- NOT NULL constraint: 5 cột (xem cột Null ở bảng trên).

**Index:**
- `upload_sessions_pkey`: `CREATE UNIQUE INDEX upload_sessions_pkey ON public.upload_sessions USING btree (id)`

**Tham chiếu logic từ bảng này:** `upload_sessions.user_id` → `users`. Không có FK trong DB.

### `public.users`

Tài khoản người dùng, thông tin hồ sơ và đăng nhập.

Entity: `User`; Repository: `UserRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `created_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm tạo bản ghi. |
| `delete_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm xóa mềm theo tên cột hiện có. |
| `email` | `character varying(255)` | Có | — | — | Địa chỉ email người dùng. |
| `full_name` | `character varying(255)` | Không | — | — | Họ tên người dùng. |
| `is_active` | `boolean` | Có | — | — | Cờ tài khoản đang hoạt động. |
| `password_hash` | `character varying(255)` | Có | — | — | Hash mật khẩu người dùng. |
| `updated_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm cập nhật bản ghi. |
| `phone` | `character varying(255)` | Có | — | — | Số điện thoại người dùng. |
| `token_version` | `bigint` | Không | 0 | — | Phiên bản token để vô hiệu hóa phiên cũ. |
| `department` | `character varying(255)` | Có | — | — | Đơn vị/phòng ban. |
| `position` | `character varying(255)` | Có | — | — | Chức danh. |
| `user_code` | `character varying(30)` | Có | — | — | Mã người dùng. |
| `auth_provider` | `character varying(20)` | Không | 'LOCAL'::character varying | — | Nhà cung cấp đăng nhập. |
| `provider_id` | `character varying(100)` | Có | — | — | Định danh người dùng tại nhà cung cấp đăng nhập. |
| `avatar_url` | `text` | Có | — | — | Địa chỉ ảnh đại diện. |

**Constraint:**
- `uk_6dotkott2kjsp8vw4d0m25fb7`: `UNIQUE (email)`
- `uk_du5v5sr43g5bfnji4vb8hg5s3`: `UNIQUE (phone)`
- `users_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 4 cột (xem cột Null ở bảng trên).

**Index:**
- `idx_users_provider`: `CREATE INDEX idx_users_provider ON public.users USING btree (auth_provider, provider_id)`
- `uk_6dotkott2kjsp8vw4d0m25fb7`: `CREATE UNIQUE INDEX uk_6dotkott2kjsp8vw4d0m25fb7 ON public.users USING btree (email)`
- `uk_du5v5sr43g5bfnji4vb8hg5s3`: `CREATE UNIQUE INDEX uk_du5v5sr43g5bfnji4vb8hg5s3 ON public.users USING btree (phone)`
- `users_pkey`: `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)`

### `public.workspace_members`

Thành viên và vai trò trong workspace; không có bảng workspaces trong DB này.

Entity: `WorkspaceMember`; Repository: `WorkspaceMemberRepository`.

| Cột | Kiểu DB | Null | Default | PK | Mô tả |
|---|---|---|---|---|---|
| `id` | `uuid` | Không | — | Có | Định danh bản ghi. |
| `joined_at` | `timestamp(6) with time zone` | Có | — | — | Thời điểm tham gia workspace. |
| `role` | `character varying(50)` | Có | — | — | Vai trò thành viên workspace. |
| `user_id` | `uuid` | Không | — | — | Định danh người dùng liên quan; DB không có FK. |
| `workspace_id` | `uuid` | Không | — | — | Định danh workspace; không có bảng workspaces trong DB này. |

**Constraint:**
- `workspace_members_pkey`: `PRIMARY KEY (id)`
- NOT NULL constraint: 3 cột (xem cột Null ở bảng trên).

**Index:**
- `workspace_members_pkey`: `CREATE UNIQUE INDEX workspace_members_pkey ON public.workspace_members USING btree (id)`

**Tham chiếu logic từ bảng này:** `workspace_members.user_id` → `users`. Không có FK trong DB.
